import { isDeepStrictEqual } from "node:util";
import { prisma } from "../config/database.js";
import type {
  IntegrationConfig,
  Order,
  OrderItem,
  Product,
  RetailTraceSync,
  Supplier,
} from "../generated/prisma/client.js";
import { IntegrationError, RetailTraceApiError } from "./integration-errors.js";
import {
  retailTraceApi,
  type RetailTraceRecord,
  type RetailTraceRecordValue,
  type RetailTraceSchemaField,
  type RetailTraceSchemaSummary,
} from "./retailtrace-api.service.js";
import { findCompatibleSchema } from "./schema-compatibility.service.js";

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
  updateOrderSchemaId(schemaId: string): Promise<void>;
  markSubmissionStarted(
    syncId: string,
    startedAt: Date,
  ): Promise<RetailTraceSync | null>;
  saveRecord(syncId: string, record: RetailTraceRecord): Promise<RetailTraceSync>;
  markPending(syncId: string, message: string): Promise<RetailTraceSync>;
  markFailed(syncId: string, error: unknown, submissionUncertain: boolean): Promise<void>;
}

export interface SyncRecordClient {
  listRecords(): Promise<RetailTraceRecord[]>;
  getRecord(recordId: string): Promise<RetailTraceRecord>;
  createRecord(input: {
    schemaId: string;
    data: Record<string, RetailTraceRecordValue>;
  }): Promise<RetailTraceRecord>;
  listSchemas(): Promise<RetailTraceSchemaSummary[]>;
  getSchema(schemaId: string): ReturnType<typeof retailTraceApi.getSchema>;
  createSchema(input: {
    name: string;
    fields: RetailTraceSchemaField[];
  }): Promise<RetailTraceSchemaSummary>;
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
  async updateOrderSchemaId(schemaId) {
    await prisma.integrationConfig.update({
      where: { id: 1 },
      data: { orderSchemaId: schemaId },
    });
  },
  async markSubmissionStarted(syncId, startedAt) {
    const claimed = await prisma.retailTraceSync.updateMany({
      where: {
        id: syncId,
        retailTraceRecordId: null,
        submissionUncertain: false,
      },
      data: {
        submissionStartedAt: startedAt,
        submissionUncertain: true,
        syncStatus: "PENDING",
        errorMessage: null,
      },
    });
    if (claimed.count === 0) {
      return null;
    }
    return prisma.retailTraceSync.findUnique({ where: { id: syncId } });
  },
  saveRecord: (syncId, record) =>
    prisma.retailTraceSync.update({
      where: { id: syncId },
      data: {
        retailTraceRecordId: record.recordId,
        transactionId: record.transactionId,
        retailTraceStatus: record.status,
        submissionUncertain: false,
        syncStatus: record.status === "FAILED" ? "FAILED" : "SYNCED",
        errorMessage:
          record.status === "FAILED" ? "RetailTrace reports publication failure" : null,
      },
    }),
  async markPending(syncId, message) {
    await prisma.retailTraceSync.updateMany({
      where: {
        id: syncId,
        retailTraceRecordId: null,
        submissionUncertain: true,
      },
      data: {
        syncStatus: "PENDING",
        errorMessage: message,
      },
    });
    const sync = await prisma.retailTraceSync.findUnique({ where: { id: syncId } });
    if (!sync) {
      throw new IntegrationError(404, "SYNC_NOT_FOUND", "Synchronization record was not found");
    }
    return sync;
  },
  async markFailed(syncId, error, submissionUncertain) {
    const errorMessage =
      error instanceof IntegrationError
        ? `${error.code}: ${error.message}`
        : "RETAILTRACE_REQUEST_FAILED: RetailTrace synchronization failed";
    const data = {
        syncStatus: "FAILED",
        submissionUncertain,
        errorMessage,
      } as const;
    if (submissionUncertain) {
      await prisma.retailTraceSync.updateMany({
        where: { id: syncId, retailTraceRecordId: null },
        data,
      });
      return;
    }
    await prisma.retailTraceSync.update({ where: { id: syncId }, data });
  },
};

const UNCERTAIN_SUBMISSION_MESSAGE =
  "RetailTrace submission outcome is unknown. Retry will check for the existing record before submitting again.";
const RECORD_MATCH_CLOCK_TOLERANCE_MS = 5_000;

function isUncertainSubmissionError(error: unknown): boolean {
  return (
    !(error instanceof RetailTraceApiError) ||
    error.upstreamStatus === null ||
    error.upstreamStatus >= 500
  );
}

function matchesRecord(
  record: RetailTraceRecord,
  schemaId: string,
  data: Record<string, RetailTraceRecordValue>,
  startedAt: Date | null,
): boolean {
  if (!startedAt || record.schemaId !== schemaId || !isDeepStrictEqual(record.data, data)) {
    return false;
  }
  const createdAt = Date.parse(record.createdAt);
  return (
    Number.isFinite(createdAt) &&
    createdAt >= startedAt.getTime() - RECORD_MATCH_CLOCK_TOLERANCE_MS
  );
}

function validatePublicationState(record: RetailTraceRecord): void {
  if (record.status === "CONFIRMED" && !record.transactionId) {
    throw new RetailTraceApiError(
      502,
      "RETAILTRACE_TRANSACTION_ID_MISSING",
      "RetailTrace marked a record confirmed without returning its transaction ID",
      null,
    );
  }
}

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

  async function getOrderSchemaId(
    productSchemaId: string,
    itemCount: number,
  ): Promise<string> {
    const fields: RetailTraceSchemaField[] = [
      { name: "customerName", type: "string", required: true },
      { name: "total", type: "number", required: true },
      { name: "status", type: "string", required: true },
    ];
    for (let index = 1; index <= itemCount; index += 1) {
      fields.push(
        {
          name: `product${index}`,
          type: "reference",
          targetSchemaId: productSchemaId,
          required: true,
        },
        { name: `quantity${index}`, type: "integer", required: true },
      );
    }

    const name = itemCount === 1 ? "Order" : `Order-${itemCount}-Products`;
    const config = await repository.getIntegrationConfig();
    const schemas = await recordClient.listSchemas();
    const matchingSchema = await findCompatibleSchema(
      recordClient,
      name,
      fields,
      config?.orderSchemaId ?? null,
      schemas,
    );
    const schema = matchingSchema ?? await recordClient.createSchema({ name, fields });
    await repository.updateOrderSchemaId(schema.schemaId);
    return schema.schemaId;
  }

  async function recoverUncertainSubmission(
    sync: RetailTraceSync,
    schemaId: string,
    data: Record<string, RetailTraceRecordValue>,
  ): Promise<RetailTraceSync> {
    try {
      const records = await recordClient.listRecords();
      const candidates = records.filter((record) =>
        matchesRecord(record, schemaId, data, sync.submissionStartedAt),
      );
      if (candidates.length === 0) {
        return repository.markPending(sync.id, UNCERTAIN_SUBMISSION_MESSAGE);
      }
      if (candidates.length > 1) {
        const error = new IntegrationError(
          502,
          "AMBIGUOUS_RETAILTRACE_RECORD",
          "Multiple RetailTrace records match this uncertain submission; no duplicate was created",
        );
        await repository.markFailed(sync.id, error, true);
        throw error;
      }
      const record = candidates[0];
      if (!record) {
        return repository.markPending(sync.id, UNCERTAIN_SUBMISSION_MESSAGE);
      }
      validatePublicationState(record);
      return await repository.saveRecord(sync.id, record);
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "AMBIGUOUS_RETAILTRACE_RECORD") {
        throw error;
      }
      await repository.markFailed(sync.id, error, true);
      throw error;
    }
  }

  async function synchronizeRecord(
    sync: RetailTraceSync,
    schemaId: string,
    data: Record<string, RetailTraceRecordValue>,
    onSubmissionStarted: () => void,
  ): Promise<RetailTraceSync> {
    if (sync.retailTraceRecordId) {
      try {
        const record = await recordClient.getRecord(sync.retailTraceRecordId);
        validatePublicationState(record);
        return await repository.saveRecord(sync.id, record);
      } catch (error) {
        await repository.markFailed(sync.id, error, false);
        throw error;
      }
    }

    if (sync.submissionUncertain) {
      return recoverUncertainSubmission(sync, schemaId, data);
    }

    const startedAt = new Date();
    const submitting = await repository.markSubmissionStarted(sync.id, startedAt);
    if (!submitting) {
      const current = await repository.findSync(sync.id);
      if (!current) {
        throw new IntegrationError(
          404,
          "SYNC_NOT_FOUND",
          "Synchronization record was not found",
        );
      }
      if (current.retailTraceRecordId) {
        return synchronizeRecord(current, schemaId, data, onSubmissionStarted);
      }
      if (current.submissionUncertain) {
        return recoverUncertainSubmission(current, schemaId, data);
      }
      throw new IntegrationError(
        409,
        "SYNC_IN_PROGRESS",
        "Another synchronization attempt is already in progress",
      );
    }
    onSubmissionStarted();
    let record: RetailTraceRecord;
    try {
      record = await recordClient.createRecord({ schemaId, data });
      validatePublicationState(record);
    } catch (error) {
      const uncertain = isUncertainSubmissionError(error);
      await repository.markFailed(sync.id, error, uncertain);
      if (uncertain) {
        return recoverUncertainSubmission(
          { ...submitting, submissionUncertain: true },
          schemaId,
          data,
        );
      }
      throw error;
    }
    return repository.saveRecord(sync.id, record);
  }

  async function syncSupplier(supplierId: string): Promise<RetailTraceSync> {
    const supplier = await repository.findSupplier(supplierId);
    if (!supplier) {
      throw new IntegrationError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found");
    }

    const sync = await repository.getOrCreateSync("Supplier", supplier.id);
    let submissionStarted = false;
    try {
      const schemaId = await getSchemaId("supplierSchemaId", "Supplier");
      return await synchronizeRecord(
        sync,
        schemaId,
        {
          name: supplier.name,
          email: supplier.email,
          country: supplier.country,
          active: supplier.active,
        },
        () => {
          submissionStarted = true;
        },
      );
    } catch (error) {
      if (!sync.submissionUncertain && !submissionStarted) {
        await repository.markFailed(sync.id, error, false);
      }
      throw error;
    }
  }

  async function syncProduct(productId: string): Promise<RetailTraceSync> {
    const product = await repository.findProduct(productId);
    if (!product) {
      throw new IntegrationError(404, "PRODUCT_NOT_FOUND", "Product was not found");
    }

    const sync = await repository.getOrCreateSync("Product", product.id);
    let submissionStarted = false;
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
      return await synchronizeRecord(
        sync,
        schemaId,
        {
          name: product.name,
          price: product.price.toNumber(),
          stockQuantity: product.stockQuantity,
          organic: product.organic,
          manufacturedOn: product.manufacturedOn.toISOString(),
          supplierId: supplierSync.retailTraceRecordId,
        },
        () => {
          submissionStarted = true;
        },
      );
    } catch (error) {
      if (!sync.submissionUncertain && !submissionStarted) {
        await repository.markFailed(sync.id, error, false);
      }
      throw error;
    }
  }

  async function syncOrder(orderId: string): Promise<RetailTraceSync> {
    const order = await repository.findOrder(orderId);
    if (!order) {
      throw new IntegrationError(404, "ORDER_NOT_FOUND", "Order was not found");
    }

    const sync = await repository.getOrCreateSync("Order", order.id);
    let submissionStarted = false;
    try {
      if (order.items.length === 0) {
        throw new IntegrationError(
          422,
          "ORDER_ITEMS_REQUIRED",
          "At least one OrderItem is required to synchronize an Order",
        );
      }
      const productRecords: Array<{ recordId: string; quantity: number }> = [];
      for (const item of order.items) {
        const productSync = await syncProduct(item.productId);
        if (!productSync.retailTraceRecordId) {
          throw new IntegrationError(
            502,
            "PRODUCT_RECORD_MISSING",
            `Product '${item.productId}' has no RetailTrace record ID`,
          );
        }
        productRecords.push({
          recordId: productSync.retailTraceRecordId,
          quantity: item.quantity,
        });
      }

      const productSchemaId = await getSchemaId("productSchemaId", "Product");
      const schemaId = await getOrderSchemaId(productSchemaId, productRecords.length);
      const data: Record<string, RetailTraceRecordValue> = {
        customerName: order.customerName,
        total: order.total.toNumber(),
        status: order.status,
      };
      for (const [index, product] of productRecords.entries()) {
        data[`product${index + 1}`] = product.recordId;
        data[`quantity${index + 1}`] = product.quantity;
      }
      return await synchronizeRecord(sync, schemaId, data, () => {
        submissionStarted = true;
      });
    } catch (error) {
      if (!sync.submissionUncertain && !submissionStarted) {
        await repository.markFailed(sync.id, error, false);
      }
      throw error;
    }
  }

  async function retryFailedSync(syncId: string): Promise<RetailTraceSync> {
    const sync = await repository.findSync(syncId);
    if (!sync) {
      throw new IntegrationError(404, "SYNC_NOT_FOUND", "Synchronization record was not found");
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
