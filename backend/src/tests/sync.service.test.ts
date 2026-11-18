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
import type {
  RetailTraceRecord,
  RetailTraceRecordValue,
  RetailTraceSchema,
  RetailTraceSchemaField,
  RetailTraceSchemaSummary,
} from "../services/retailtrace-api.service.js";

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
  const syncs = new Map<string, RetailTraceSync>();
  const syncKey = (entityType: EntityType, localEntityId: string) =>
    `${entityType}:${localEntityId}`;
  const addSync = (
    entityType: EntityType,
    localEntityId: string,
    recordId: string | null = null,
    status: "PENDING" | "SYNCED" | "FAILED" = "PENDING",
  ) => {
    const sync: RetailTraceSync = {
      id: `sync-${syncs.size + 1}`,
      entityType,
      localEntityId,
      retailTraceRecordId: recordId,
      transactionId: null,
      retailTraceStatus: null,
      submissionUncertain: false,
      submissionStartedAt: null,
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
    "507f1f77bcf86cd799439011",
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
      return {
        ...order,
        items: [...order.items].sort((a, b) => a.productId.localeCompare(b.productId)),
      };
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
    async updateOrderSchemaId(schemaId) {
      config.orderSchemaId = schemaId;
    },
    async markSubmissionStarted(syncId, startedAt) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      if (sync.submissionUncertain || sync.retailTraceRecordId) return null;
      sync.submissionStartedAt = startedAt;
      sync.submissionUncertain = true;
      sync.syncStatus = "PENDING";
      sync.errorMessage = null;
      return sync;
    },
    async saveRecord(syncId, record) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      sync.retailTraceRecordId = record.recordId;
      sync.transactionId = record.transactionId;
      sync.retailTraceStatus = record.status;
      sync.submissionUncertain = false;
      sync.syncStatus = record.status === "FAILED" ? "FAILED" : "SYNCED";
      sync.errorMessage = record.status === "FAILED"
        ? "RetailTrace reports publication failure"
        : null;
      return sync;
    },
    async markPending(syncId, message) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      if (sync.retailTraceRecordId || !sync.submissionUncertain) return sync;
      sync.syncStatus = "PENDING";
      sync.errorMessage = message;
      return sync;
    },
    async markFailed(syncId, error, submissionUncertain) {
      const sync = [...syncs.values()].find((item) => item.id === syncId);
      assert.ok(sync);
      if (submissionUncertain && sync.retailTraceRecordId) return;
      sync.syncStatus = "FAILED";
      sync.submissionUncertain = submissionUncertain;
      sync.errorMessage = error instanceof Error ? error.message : "Request failed";
    },
  };

  const records: RetailTraceRecord[] = [{
    recordId: supplierSync.retailTraceRecordId!,
    businessId: "business-1",
    schemaId: "supplier-schema",
    data: {
      name: supplier.name,
      email: supplier.email,
      country: supplier.country,
      active: supplier.active,
    },
    transactionId: "tx-supplier",
    status: "CONFIRMED",
    createdAt: now.toISOString(),
  }];
  const schemas: RetailTraceSchema[] = [];
  const calls: Array<{
    schemaId: string;
    data: Record<string, RetailTraceRecordValue>;
  }> = [];
  let nextRecord = 1;
  const recordClient: SyncRecordClient = {
    async listRecords() {
      return records;
    },
    async getRecord(recordId) {
      const record = records.find((item) => item.recordId === recordId);
      if (!record) {
        throw new RetailTraceApiError(502, "RECORD_NOT_FOUND", "Record not found", 404);
      }
      return record;
    },
    async createRecord(input) {
      calls.push(input);
      const record: RetailTraceRecord = {
        recordId: `507f1f77bcf86cd7994390${String(nextRecord++).padStart(2, "0")}`,
        businessId: "business-1",
        schemaId: input.schemaId,
        data: input.data,
        transactionId: `tx-${nextRecord}`,
        status: "CONFIRMED",
        createdAt: new Date().toISOString(),
      };
      records.push(record);
      return record;
    },
    async listSchemas() {
      return schemas.map(({ schemaId, name, version }) => ({ schemaId, name, version }));
    },
    async getSchema(schemaId) {
      const schema = schemas.find((item) => item.schemaId === schemaId);
      if (!schema) {
        throw new RetailTraceApiError(502, "SCHEMA_NOT_FOUND", "Schema not found", 404);
      }
      return schema;
    },
    async createSchema(input: { name: string; fields: RetailTraceSchemaField[] }) {
      const schema: RetailTraceSchema = {
        schemaId: `dynamic-${schemas.length + 1}`,
        name: input.name,
        version: 1,
        fields: input.fields,
        schema: {},
      };
      schemas.push(schema);
      return {
        schemaId: schema.schemaId,
        name: schema.name,
        version: schema.version,
      };
    },
  };

  return {
    repository,
    syncs,
    supplierSync,
    order,
    config,
    records,
    schemas,
    calls,
    recordClient,
  };
}

describe("RetailTrace synchronization", () => {
  it("uses scalar RetailTrace record references for Supplier, Product, and each Order item", async () => {
    const { repository, supplierSync, order, config, calls, records, schemas, recordClient } =
      createSyncFixture();
    const service = createSyncService(repository, recordClient);

    const orderSync = await service.syncOrder(order.id);

    assert.equal(orderSync.syncStatus, "SYNCED");
    assert.equal(orderSync.retailTraceStatus, "CONFIRMED");
    assert.equal(orderSync.transactionId, "tx-4");
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.schemaId, "product-schema");
    assert.equal(calls[0]?.data.supplierId, supplierSync.retailTraceRecordId);
    assert.equal(calls[0]?.data.manufacturedOn, "2026-09-10T00:00:00.000Z");
    assert.equal(calls[1]?.schemaId, "product-schema");
    assert.equal(calls[1]?.data.supplierId, supplierSync.retailTraceRecordId);
    assert.equal(calls[2]?.schemaId, "dynamic-1");
    assert.equal(calls[2]?.data.product1, records.find((record) =>
      record.data.name === "Calendula Balm")?.recordId);
    assert.equal(calls[2]?.data.product2, records.find((record) =>
      record.data.name === "Rosehip Oil")?.recordId);
    assert.equal(calls[2]?.data.quantity1, 2);
    assert.equal(calls[2]?.data.quantity2, 1);
    assert.equal(Array.isArray(calls[2]?.data.product1), false);
    assert.equal(schemas[0]?.name, "Order-2-Products");
    assert.equal(config.orderSchemaId, schemas[0]?.schemaId);

    const callCount = calls.length;
    const retriedOrder = await service.retryFailedSync(orderSync.id);
    assert.equal(retriedOrder.retailTraceRecordId, orderSync.retailTraceRecordId);
    assert.equal(calls.length, callCount);
  });

  it("rejects a saved multiple-reference Order schema for a single-item order", async () => {
    const { repository, order, config, calls, schemas, recordClient } = createSyncFixture();
    const productV3Fields: RetailTraceSchemaField[] = [
      { name: "customerName", type: "string", required: true },
      { name: "total", type: "number", required: true },
      { name: "status", type: "string", required: true },
      {
        name: "products",
        type: "reference",
        targetSchemaId: "product-schema",
        required: true,
        multiple: true,
      },
    ];
    schemas.push({
      schemaId: "order-v3",
      name: "Order",
      version: 3,
      fields: productV3Fields,
      schema: {},
    });
    config.orderSchemaId = "order-v3";
    order.items = [order.items[0]!];
    const service = createSyncService(repository, recordClient);

    await service.syncOrder(order.id);

    assert.equal(calls.at(-1)?.schemaId, "dynamic-2");
    assert.deepEqual(schemas[1]?.fields.map((field) => field.name), [
      "customerName",
      "total",
      "status",
      "product1",
      "quantity1",
    ]);
    assert.equal(schemas[1]?.fields.find((field) => field.name === "product1")?.multiple, undefined);
    assert.equal(config.orderSchemaId, "dynamic-2");
  });

  it("reuses a compatible scalar-reference schema and selects distinct single/multi-item schemas", async () => {
    const { repository, order, config, calls, schemas, recordClient } = createSyncFixture();
    const multiFields: RetailTraceSchemaField[] = [
      { name: "customerName", type: "string", required: true },
      { name: "total", type: "number", required: true },
      { name: "status", type: "string", required: true },
      {
        name: "product1",
        type: "reference",
        targetSchemaId: "product-schema",
        required: true,
      },
      { name: "quantity1", type: "integer", required: true },
      {
        name: "product2",
        type: "reference",
        targetSchemaId: "product-schema",
        required: true,
      },
      { name: "quantity2", type: "integer", required: true },
    ];
    schemas.push({
      schemaId: "existing-order-2",
      name: "Order-2-Products",
      version: 1,
      fields: multiFields,
      schema: {},
    });
    config.orderSchemaId = "existing-order-2";
    const service = createSyncService(repository, recordClient);

    await service.syncOrder(order.id);
    assert.equal(calls[2]?.schemaId, "existing-order-2");
    assert.equal(schemas.length, 1);
    assert.equal(config.orderSchemaId, "existing-order-2");

    order.id = "local-order-single";
    order.items = [order.items[0]!];
    await service.syncOrder(order.id);
    assert.equal(schemas.length, 2);
    assert.equal(schemas[1]?.name, "Order");
    assert.equal(calls[3]?.schemaId, schemas[1]?.schemaId);
    assert.equal(config.orderSchemaId, schemas[1]?.schemaId);

    await service.syncOrder(order.id);
    assert.equal(schemas.length, 2);
  });

  it("persists the returned transaction ID for a Supplier", async () => {
    const { repository, supplierSync, calls, records, recordClient } = createSyncFixture();
    supplierSync.retailTraceRecordId = null;
    supplierSync.syncStatus = "PENDING";
    supplierSync.transactionId = null;
    supplierSync.retailTraceStatus = null;
    records.shift();
    const service = createSyncService(repository, recordClient);

    const result = await service.syncSupplier(supplierSync.localEntityId);

    assert.equal(calls.length, 1);
    assert.equal(result.transactionId, "tx-2");
    assert.equal(result.retailTraceRecordId, "507f1f77bcf86cd799439001");
    assert.equal(result.retailTraceStatus, "CONFIRMED");
    assert.equal(result.syncStatus, "SYNCED");
  });

  it("does not mark an accepted record as blockchain-confirmed while publication is pending", async () => {
    const { repository, supplierSync, calls, records, recordClient } = createSyncFixture();
    supplierSync.retailTraceRecordId = null;
    supplierSync.syncStatus = "PENDING";
    records.shift();
    recordClient.createRecord = async (input) => {
      calls.push(input);
      const record: RetailTraceRecord = {
        recordId: "507f1f77bcf86cd799439099",
        businessId: "business-1",
        schemaId: input.schemaId,
        data: input.data,
        transactionId: null,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      records.push(record);
      return record;
    };
    const service = createSyncService(repository, recordClient);

    const result = await service.syncSupplier(supplierSync.localEntityId);

    assert.equal(result.retailTraceRecordId, "507f1f77bcf86cd799439099");
    assert.equal(result.transactionId, null);
    assert.equal(result.retailTraceStatus, "PENDING");
    assert.equal(result.syncStatus, "SYNCED");
  });

  it("retains a publication-failed record mapping without claiming confirmation", async () => {
    const { repository, supplierSync, records, recordClient } = createSyncFixture();
    supplierSync.retailTraceRecordId = null;
    supplierSync.syncStatus = "PENDING";
    records.shift();
    let lookups = 0;
    recordClient.createRecord = async () => {
      throw new RetailTraceApiError(
        502,
        "PROCESSING_FAILED",
        "Record publication could not be confirmed",
        502,
      );
    };
    recordClient.listRecords = async () => {
      lookups += 1;
      if (lookups === 1) return [];
      return records;
    };
    const service = createSyncService(repository, recordClient);

    const pending = await service.syncSupplier(supplierSync.localEntityId);
    assert.equal(pending.syncStatus, "PENDING");
    assert.equal(pending.submissionUncertain, true);
    assert.equal(pending.retailTraceRecordId, null);

    records.push({
      recordId: "507f1f77bcf86cd799439098",
      businessId: "business-1",
      schemaId: "supplier-schema",
      data: {
        name: "Green Valley Botanicals",
        email: "hello@greenvalley.example",
        country: "Canada",
        active: true,
      },
      transactionId: null,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });
    const recovered = await service.retryFailedSync(pending.id);

    assert.equal(recovered.syncStatus, "SYNCED");
    assert.equal(recovered.retailTraceStatus, "PENDING");
    assert.equal(recovered.retailTraceRecordId, "507f1f77bcf86cd799439098");
  });

  it("recovers a timed-out POST without creating a duplicate record", async () => {
    const { repository, supplierSync, records, calls, recordClient } = createSyncFixture();
    supplierSync.retailTraceRecordId = null;
    supplierSync.syncStatus = "PENDING";
    records.shift();
    let lookups = 0;
    recordClient.createRecord = async (input) => {
      calls.push(input);
      throw new RetailTraceApiError(
        504,
        "RETAILTRACE_TIMEOUT",
        "RetailTrace request timed out",
        null,
      );
    };
    recordClient.listRecords = async () => {
      lookups += 1;
      return lookups === 1 ? [] : records;
    };
    const service = createSyncService(repository, recordClient);

    const pending = await service.syncSupplier(supplierSync.localEntityId);
    assert.equal(pending.syncStatus, "PENDING");
    assert.equal(pending.submissionUncertain, true);

    records.push({
      recordId: "507f1f77bcf86cd799439097",
      businessId: "business-1",
      schemaId: "supplier-schema",
      data: {
        name: "Green Valley Botanicals",
        email: "hello@greenvalley.example",
        country: "Canada",
        active: true,
      },
      transactionId: "tx-recovered",
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
    });
    const recovered = await service.retryFailedSync(pending.id);

    assert.equal(calls.length, 1);
    assert.equal(recovered.retailTraceRecordId, "507f1f77bcf86cd799439097");
    assert.equal(recovered.transactionId, "tx-recovered");
    assert.equal(recovered.retailTraceStatus, "CONFIRMED");
    assert.equal(recovered.submissionUncertain, false);
  });

  it("allows only one concurrent POST for the same local mapping", async () => {
    const { repository, supplierSync, calls, records, recordClient } = createSyncFixture();
    supplierSync.retailTraceRecordId = null;
    supplierSync.syncStatus = "PENDING";
    records.shift();
    const getOrCreateSync = repository.getOrCreateSync.bind(repository);
    repository.getOrCreateSync = async (entityType, localEntityId) => ({
      ...await getOrCreateSync(entityType, localEntityId),
    });

    let releaseCreate: (() => void) | undefined;
    let signalCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      signalCreateStarted = resolve;
    });
    const allowCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    recordClient.createRecord = async (input) => {
      calls.push(input);
      signalCreateStarted?.();
      await allowCreate;
      return {
        recordId: "507f1f77bcf86cd799439096",
        businessId: "business-1",
        schemaId: input.schemaId,
        data: input.data,
        transactionId: "tx-concurrent",
        status: "CONFIRMED",
        createdAt: new Date().toISOString(),
      };
    };
    const service = createSyncService(repository, recordClient);

    const first = service.syncSupplier(supplierSync.localEntityId);
    await createStarted;
    const second = await service.syncSupplier(supplierSync.localEntityId);
    assert.equal(second.submissionUncertain, true);
    releaseCreate?.();
    const firstResult = await first;

    assert.equal(calls.length, 1);
    assert.equal(firstResult.retailTraceRecordId, "507f1f77bcf86cd799439096");
  });
});
