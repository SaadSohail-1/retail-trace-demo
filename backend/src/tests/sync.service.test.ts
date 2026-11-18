import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Prisma,
  type IntegrationConfig,
  type Order,
  type OrderItem,
  type Product,
  type RetailTraceSync,
  type Supplier,
} from "../generated/prisma/client.js";
import { RetailTraceApiError } from "../services/integration-errors.js";
import {
  createSyncService,
  type SyncRecordClient,
  type SyncRepository,
} from "../services/sync.service.js";
import type { RetailTraceRecordValue } from "../services/retailtrace-api.service.js";

type EntityType = "Supplier" | "Product" | "Order";

function createSyncFixture() {
  const now = new Date();
  const supplier: Supplier = {
    id: "local-supplier-1",
    name: "Green Valley Botanicals",
    email: "hello@greenvalley.example",
    country: "Canada",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const products: Product[] = [
    {
      id: "local-product-a",
      name: "Calendula Balm",
      price: new Prisma.Decimal("10.00"),
      stockQuantity: 20,
      organic: true,
      manufacturedOn: new Date("2026-09-10T00:00:00.000Z"),
      supplierId: supplier.id,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "local-product-b",
      name: "Rosehip Oil",
      price: new Prisma.Decimal("7.50"),
      stockQuantity: 15,
      organic: true,
      manufacturedOn: new Date("2026-09-12T00:00:00.000Z"),
      supplierId: supplier.id,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const order: Order & { items: OrderItem[] } = {
    id: "local-order-1",
    customerName: "Morgan Lee",
    total: new Prisma.Decimal("27.50"),
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: "order-item-b",
        orderId: "local-order-1",
        productId: "local-product-b",
        quantity: 1,
        unitPrice: new Prisma.Decimal("7.50"),
      },
      {
        id: "order-item-a",
        orderId: "local-order-1",
        productId: "local-product-a",
        quantity: 2,
        unitPrice: new Prisma.Decimal("10.00"),
      },
    ],
  };
  const config: IntegrationConfig = {
    id: 1,
    supplierSchemaId: "supplier-schema",
    productSchemaId: "product-schema",
    orderSchemaId: "order-schema",
    initialized: true,
    createdAt: now,
    updatedAt: now,
  };
  let nextSyncId = 0;
  const syncs = new Map<string, RetailTraceSync>();
  const syncKey = (entityType: EntityType, localEntityId: string) =>
    `${entityType}:${localEntityId}`;
  const addSync = (
    entityType: EntityType,
    localEntityId: string,
    recordId: string | null = null,
    status: "PENDING" | "SYNCED" | "FAILED" = "PENDING",
  ) => {
    nextSyncId += 1;
    const sync: RetailTraceSync = {
      id: `sync-${nextSyncId}`,
      entityType,
      localEntityId,
      retailTraceRecordId: recordId,
      transactionId: null,
      syncStatus: status,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    syncs.set(syncKey(entityType, localEntityId), sync);
    return sync;
  };
  const supplierSync = addSync(
    "Supplier",
    supplier.id,
    "507f1f77bcf86cd799439001",
    "SYNCED",
  );
  const repository: SyncRepository = {
    async findSupplier(id) {
      return id === supplier.id ? supplier : null;
    },
    async findProduct(id) {
      return products.find((product) => product.id === id) ?? null;
    },
    async findOrder(id) {
      if (id !== order.id) return null;
      return { ...order, items: [...order.items].sort((a, b) => a.productId.localeCompare(b.productId)) };
    },
    async findSync(id) {
      return [...syncs.values()].find((sync) => sync.id === id) ?? null;
    },
    async getOrCreateSync(entityType, localEntityId) {
      return syncs.get(syncKey(entityType, localEntityId)) ??
        addSync(entityType, localEntityId);
    },
    async getIntegrationConfig() {
      return config;
    },
    async markSynced(syncId, retailTraceRecordId) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      sync.retailTraceRecordId = retailTraceRecordId;
      sync.syncStatus = "SYNCED";
      sync.errorMessage = null;
      return sync;
    },
    async markFailed(syncId, error) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      sync.syncStatus = "FAILED";
      sync.errorMessage =
        error instanceof Error ? error.message : "RETAILTRACE_REQUEST_FAILED";
    },
  };
  return { repository, syncs, supplierSync, order };
}

describe("RetailTrace synchronization", () => {
  it("uses RetailTrace IDs for Supplier and Product references and sends all Order products", async () => {
    const { repository, supplierSync, order } = createSyncFixture();
    const calls: Array<{
      schemaId: string;
      data: Record<string, RetailTraceRecordValue>;
      recordId: string;
    }> = [];
    const recordClient: SyncRecordClient = {
      async createRecord(input) {
        const recordId = `retailtrace-record-${calls.length + 1}`;
        calls.push({ ...input, recordId });
        return { recordId };
      },
    };
    const service = createSyncService(repository, recordClient);

    const orderSync = await service.syncOrder(order.id);

    assert.equal(orderSync.syncStatus, "SYNCED");
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.schemaId, "product-schema");
    assert.equal(calls[0]?.data.supplierId, supplierSync.retailTraceRecordId);
    assert.equal(calls[1]?.schemaId, "product-schema");
    assert.equal(calls[1]?.data.supplierId, supplierSync.retailTraceRecordId);
    assert.equal(calls[2]?.schemaId, "order-schema");
    assert.deepEqual(calls[2]?.data.products, [
      calls[0]?.recordId,
      calls[1]?.recordId,
    ]);

    const callCount = calls.length;
    const retriedOrder = await service.retryFailedSync(orderSync.id);
    assert.equal(retriedOrder.retailTraceRecordId, orderSync.retailTraceRecordId);
    assert.equal(calls.length, callCount);
  });

  it("retries a failed Order without resubmitting already synchronized Products", async () => {
    const { repository, syncs, order } = createSyncFixture();
    const calls: Array<{
      schemaId: string;
      data: Record<string, RetailTraceRecordValue>;
    }> = [];
    let failOrderOnce = true;
    const recordClient: SyncRecordClient = {
      async createRecord(input) {
        calls.push(input);
        if (input.schemaId === "order-schema" && failOrderOnce) {
          failOrderOnce = false;
          throw new RetailTraceApiError(
            503,
            "RETAILTRACE_UNAVAILABLE",
            "RetailTrace could not be reached",
            null,
          );
        }
        return { recordId: `retailtrace-record-${calls.length}` };
      },
    };
    const service = createSyncService(repository, recordClient);

    await assert.rejects(service.syncOrder(order.id), RetailTraceApiError);
    const failedOrderSync = syncs.get(`Order:${order.id}`);
    assert.ok(failedOrderSync);
    assert.equal(failedOrderSync?.syncStatus, "FAILED");
    assert.equal(failedOrderSync?.retailTraceRecordId, null);

    const retriedOrder = await service.retryFailedSync(failedOrderSync.id);
    assert.equal(retriedOrder.syncStatus, "SYNCED");
    assert.equal(retriedOrder.retailTraceRecordId, "retailtrace-record-4");
    assert.equal(calls.filter(({ schemaId }) => schemaId === "product-schema").length, 2);
    assert.equal(calls.filter(({ schemaId }) => schemaId === "order-schema").length, 2);
    assert.deepEqual(calls.at(-1)?.data.products, [
      "retailtrace-record-1",
      "retailtrace-record-2",
    ]);
  });
});
