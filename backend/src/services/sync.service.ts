import { prisma } from "../config/database.js";
import type {
  IntegrationConfig,
  Order,
  OrderItem,
  Product,
  RetailTraceSync,
  Supplier,
} from "../generated/prisma/client.js";
import { IntegrationError } from "./integration-errors.js";
import {
  retailTraceApi,
  type RetailTraceRecordValue,
} from "./retailtrace-api.service.js";

type EntityType = "Supplier" | "Product" | "Order";
type SchemaKey = "supplierSchemaId" | "productSchemaId" | "orderSchemaId";
type OrderWithItems = Order & { items: OrderItem[] };

export interface SyncRepository {
  findSupplier(id: string): Promise<Supplier | null>;
  findProduct(id: string): Promise<Product | null>;
  findOrder(id: string): Promise<OrderWithItems | null>;
  findSync(id: string): Promise<RetailTraceSync | null>;
  getOrCreateSync(entityType: EntityType, localEntityId: string): Promise<RetailTraceSync>;
  getIntegrationConfig(): Promise<IntegrationConfig | null>;
  markSynced(syncId: string, retailTraceRecordId: string): Promise<RetailTraceSync>;
  markFailed(syncId: string, error: unknown): Promise<void>;
}

export interface SyncRecordClient {
  createRecord(input: {
    schemaId: string;
    data: Record<string, RetailTraceRecordValue>;
  }): Promise<{ recordId: string }>;
}

const prismaSyncRepository: SyncRepository = {
  findSupplier: (id) => prisma.supplier.findUnique({ where: { id } }),
  findProduct: (id) => prisma.product.findUnique({ where: { id } }),
  findOrder: (id) =>
    prisma.order.findUnique({
      where: { id },
      include: { items: { orderBy: { productId: "asc" } } },
    }),
  findSync: (id) => prisma.retailTraceSync.findUnique({ where: { id } }),
  getOrCreateSync: (entityType, localEntityId) =>
    prisma.retailTraceSync.upsert({
      where: { entityType_localEntityId: { entityType, localEntityId } },
      create: { entityType, localEntityId, syncStatus: "PENDING" },
      update: {},
    }),
  getIntegrationConfig: () => prisma.integrationConfig.findUnique({ where: { id: 1 } }),
  markSynced: (syncId, retailTraceRecordId) =>
    prisma.retailTraceSync.update({
      where: { id: syncId },
      data: { retailTraceRecordId, syncStatus: "SYNCED", errorMessage: null },
    }),
  async markFailed(syncId, error) {
    const errorMessage =
      error instanceof IntegrationError
        ? `${error.code}: ${error.message}`
        : "RETAILTRACE_REQUEST_FAILED: RetailTrace synchronization failed";
    await prisma.retailTraceSync.update({
      where: { id: syncId },
      data: { syncStatus: "FAILED", errorMessage },
    });
  },
};

export function createSyncService(
  repository: SyncRepository = prismaSyncRepository,
  recordClient: SyncRecordClient = retailTraceApi,
) {
  async function getSchemaId(key: SchemaKey, label: string): Promise<string> {
    const config = await repository.getIntegrationConfig();
    const schemaId = config?.[key];
    if (!schemaId) {
      throw new IntegrationError(
        409,
        "SCHEMA_NOT_INITIALIZED",
        `The RetailTrace ${label} schema has not been initialized`,
      );
    }
    return schemaId;
  }

  async function syncSupplier(supplierId: string): Promise<RetailTraceSync> {
    const supplier = await repository.findSupplier(supplierId);
    if (!supplier) {
      throw new IntegrationError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found");
    }

    const sync = await repository.getOrCreateSync("Supplier", supplier.id);
    if (sync.retailTraceRecordId) {
      return sync.syncStatus === "SYNCED"
        ? sync
        : repository.markSynced(sync.id, sync.retailTraceRecordId);
    }

    try {
      const schemaId = await getSchemaId("supplierSchemaId", "Supplier");
      const record = await recordClient.createRecord({
        schemaId,
        data: {
          name: supplier.name,
          email: supplier.email,
          country: supplier.country,
          active: supplier.active,
        },
      });
      return await repository.markSynced(sync.id, record.recordId);
    } catch (error) {
      await repository.markFailed(sync.id, error);
      throw error;
    }
  }

  async function syncProduct(productId: string): Promise<RetailTraceSync> {
    const product = await repository.findProduct(productId);
    if (!product) {
      throw new IntegrationError(404, "PRODUCT_NOT_FOUND", "Product was not found");
    }

    const sync = await repository.getOrCreateSync("Product", product.id);
    if (sync.retailTraceRecordId) {
      return sync.syncStatus === "SYNCED"
        ? sync
        : repository.markSynced(sync.id, sync.retailTraceRecordId);
    }

    try {
      const supplierSync = await syncSupplier(product.supplierId);
      if (!supplierSync.retailTraceRecordId) {
        throw new IntegrationError(
          502,
          "SUPPLIER_RECORD_MISSING",
          "The Supplier has no RetailTrace record ID",
        );
      }

      const schemaId = await getSchemaId("productSchemaId", "Product");
      const record = await recordClient.createRecord({
        schemaId,
        data: {
          name: product.name,
          price: product.price.toNumber(),
          stockQuantity: product.stockQuantity,
          organic: product.organic,
          manufacturedOn: product.manufacturedOn.toISOString().slice(0, 10),
          supplierId: supplierSync.retailTraceRecordId,
        },
      });
      return await repository.markSynced(sync.id, record.recordId);
    } catch (error) {
      await repository.markFailed(sync.id, error);
      throw error;
    }
  }

  async function syncOrder(orderId: string): Promise<RetailTraceSync> {
    const order = await repository.findOrder(orderId);
    if (!order) {
      throw new IntegrationError(404, "ORDER_NOT_FOUND", "Order was not found");
    }

    const sync = await repository.getOrCreateSync("Order", order.id);
    if (sync.retailTraceRecordId) {
      return sync.syncStatus === "SYNCED"
        ? sync
        : repository.markSynced(sync.id, sync.retailTraceRecordId);
    }

    try {
      if (order.items.length === 0) {
        throw new IntegrationError(
          422,
          "ORDER_ITEMS_REQUIRED",
          "At least one OrderItem is required to synchronize an Order",
        );
      }
      const productRecordIds: string[] = [];
      for (const item of order.items) {
        const productSync = await syncProduct(item.productId);
        if (!productSync.retailTraceRecordId) {
          throw new IntegrationError(
            502,
            "PRODUCT_RECORD_MISSING",
            `Product '${item.productId}' has no RetailTrace record ID`,
          );
        }
        productRecordIds.push(productSync.retailTraceRecordId);
      }

      const schemaId = await getSchemaId("orderSchemaId", "Order");
      const record = await recordClient.createRecord({
        schemaId,
        data: {
          customerName: order.customerName,
          total: order.total.toNumber(),
          status: order.status,
          products: productRecordIds,
        },
      });
      return await repository.markSynced(sync.id, record.recordId);
    } catch (error) {
      await repository.markFailed(sync.id, error);
      throw error;
    }
  }

  async function retryFailedSync(syncId: string): Promise<RetailTraceSync> {
    const sync = await repository.findSync(syncId);
    if (!sync) {
      throw new IntegrationError(404, "SYNC_NOT_FOUND", "Synchronization record was not found");
    }

    if (sync.retailTraceRecordId) {
      return sync.syncStatus === "SYNCED"
        ? sync
        : repository.markSynced(sync.id, sync.retailTraceRecordId);
    }

    if (sync.entityType === "Supplier") {
      return syncSupplier(sync.localEntityId);
    }
    if (sync.entityType === "Product") {
      return syncProduct(sync.localEntityId);
    }
    if (sync.entityType === "Order") {
      return syncOrder(sync.localEntityId);
    }

    throw new IntegrationError(
      400,
      "UNSUPPORTED_SYNC_ENTITY",
      `Synchronization retries are not supported for ${sync.entityType}`,
    );
  }

  return { syncSupplier, syncProduct, syncOrder, retryFailedSync };
}

const syncService = createSyncService();

export const syncSupplier = syncService.syncSupplier;
export const syncProduct = syncService.syncProduct;
export const syncOrder = syncService.syncOrder;
export const retryFailedSync = syncService.retryFailedSync;
