import { prisma } from "../config/database.js";
import type { RetailTraceSync } from "../generated/prisma/client.js";
import { IntegrationError, RetailTraceApiError } from "./integration-errors.js";
import {
  retailTraceApi,
  type RetailTraceSchema,
  type RetailTraceSchemaField,
  type RetailTraceSchemaSummary,
} from "./retailtrace-api.service.js";
import { syncOrder, syncProduct, syncSupplier } from "./sync.service.js";

type SchemaKey = "supplierSchemaId" | "productSchemaId" | "orderSchemaId";
type SchemaName = "Supplier" | "Product" | "Order";

interface SchemaDefinition {
  key: SchemaKey;
  name: SchemaName;
  fields: (supplierSchemaId?: string, productSchemaId?: string) => RetailTraceSchemaField[];
}

const schemaDefinitions: SchemaDefinition[] = [
  {
    key: "supplierSchemaId",
    name: "Supplier",
    fields: () => [
      { name: "name", type: "string", required: true },
      { name: "email", type: "string", required: true },
      { name: "country", type: "string", required: true },
      { name: "active", type: "boolean", required: true },
    ],
  },
  {
    key: "productSchemaId",
    name: "Product",
    fields: (supplierSchemaId) => [
      { name: "name", type: "string", required: true },
      { name: "price", type: "number", required: true },
      { name: "stockQuantity", type: "integer", required: true },
      { name: "organic", type: "boolean", required: true },
      { name: "manufacturedOn", type: "date", required: true },
      {
        name: "supplierId",
        type: "reference",
        targetSchemaId: supplierSchemaId ?? "",
        required: true,
      },
    ],
  },
  {
    key: "orderSchemaId",
    name: "Order",
    fields: (_supplierSchemaId, productSchemaId) => [
      { name: "customerName", type: "string", required: true },
      { name: "total", type: "number", required: true },
      { name: "status", type: "string", required: true },
      {
        name: "products",
        type: "reference",
        targetSchemaId: productSchemaId ?? "",
        multiple: true,
        required: true,
      },
    ],
  },
];

function fieldsMatch(
  actual: RetailTraceSchemaField[],
  expected: RetailTraceSchemaField[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  return expected.every((field) => {
    const candidate = actual.find((item) => item.name === field.name);
    return (
      candidate?.type === field.type &&
      candidate.required === field.required &&
      (field.type !== "reference" ||
        (candidate.targetSchemaId === field.targetSchemaId &&
          (candidate.multiple ?? false) === (field.multiple ?? false)))
    );
  });
}

function getErrorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof IntegrationError) {
    return { code: error.code, message: error.message };
  }
  return { code: "INTEGRATION_INITIALIZATION_FAILED", message: "Integration initialization failed" };
}

async function findMatchingSchema(
  name: SchemaName,
  fields: RetailTraceSchemaField[],
  savedSchemaId: string | null,
  existingSchemas: RetailTraceSchemaSummary[],
): Promise<{
  matchingSchema?: RetailTraceSchemaSummary;
  schemaToUpdate?: RetailTraceSchemaSummary;
}> {
  const namedSchemas = existingSchemas
    .filter((schema) => schema.name === name)
    .sort((left, right) => right.version - left.version);
  const details = new Map<string, RetailTraceSchema>();

  const readSchema = async (schemaId: string): Promise<RetailTraceSchema | undefined> => {
    if (details.has(schemaId)) {
      return details.get(schemaId);
    }

    try {
      const schema = await retailTraceApi.getSchema(schemaId);
      details.set(schemaId, schema);
      return schema;
    } catch (error) {
      if (error instanceof RetailTraceApiError && error.upstreamStatus === 404) {
        return undefined;
      }
      throw error;
    }
  };

  if (savedSchemaId) {
    const savedSchema = await readSchema(savedSchemaId);
    if (
      savedSchema?.name === name &&
      fieldsMatch(savedSchema.fields, fields)
    ) {
      return {
        matchingSchema: {
          schemaId: savedSchema.schemaId,
          name: savedSchema.name,
          version: savedSchema.version,
        },
      };
    }
  }

  for (const candidate of namedSchemas) {
    const schema = await readSchema(candidate.schemaId);
    if (schema?.name === name && fieldsMatch(schema.fields, fields)) {
      return { matchingSchema: candidate };
    }
  }

  const latestSchema = namedSchemas.at(0);
  if (latestSchema) {
    return { schemaToUpdate: latestSchema };
  }

  return {};
}

async function ensureIntegrationConfig() {
  return prisma.integrationConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}

export async function initializeIntegration() {
  const config = await ensureIntegrationConfig();
  const completed: SchemaName[] = [];

  let existingSchemas: RetailTraceSchemaSummary[];
  try {
    existingSchemas = await retailTraceApi.listSchemas();
  } catch (error) {
    const details = getErrorDetails(error);
    return {
      status: "failed" as const,
      initialized: config.initialized,
      schemas: {
        supplierSchemaId: config.supplierSchemaId,
        productSchemaId: config.productSchemaId,
        orderSchemaId: config.orderSchemaId,
      },
      completed,
      failedAt: "Supplier" as const,
      error: details,
    };
  }

  let supplierSchemaId = config.supplierSchemaId;
  let productSchemaId = config.productSchemaId;
  let orderSchemaId = config.orderSchemaId;

  for (const definition of schemaDefinitions) {
    const fields = definition.fields(supplierSchemaId ?? undefined, productSchemaId ?? undefined);

    try {
      const savedSchemaId =
        definition.key === "supplierSchemaId"
          ? supplierSchemaId
          : definition.key === "productSchemaId"
            ? productSchemaId
            : orderSchemaId;
      const { matchingSchema, schemaToUpdate } = await findMatchingSchema(
        definition.name,
        fields,
        savedSchemaId,
        existingSchemas,
      );
      const schema = matchingSchema
        ? matchingSchema
        : schemaToUpdate
          ? await retailTraceApi.updateSchema(schemaToUpdate.schemaId, {
              name: definition.name,
              fields,
            })
          : await retailTraceApi.createSchema({
              name: definition.name,
              fields,
            });

      switch (definition.key) {
        case "supplierSchemaId":
          supplierSchemaId = schema.schemaId;
          break;
        case "productSchemaId":
          productSchemaId = schema.schemaId;
          break;
        case "orderSchemaId":
          orderSchemaId = schema.schemaId;
          break;
      }

      await prisma.integrationConfig.update({
        where: { id: 1 },
        data: { [definition.key]: schema.schemaId },
      });

      if (!matchingSchema) {
        existingSchemas.push(schema);
      }
      completed.push(definition.name);
    } catch (error) {
      const details = getErrorDetails(error);
      return {
        status: completed.length > 0 ? ("partial" as const) : ("failed" as const),
        initialized: config.initialized,
        schemas: {
          supplierSchemaId,
          productSchemaId,
          orderSchemaId,
        },
        completed,
        failedAt: definition.name,
        error: details,
      };
    }
  }

  const updatedConfig = await prisma.integrationConfig.update({
    where: { id: 1 },
    data: {
      supplierSchemaId,
      productSchemaId,
      orderSchemaId,
      initialized: true,
    },
  });

  return {
    status: "initialized" as const,
    initialized: updatedConfig.initialized,
    schemas: {
      supplierSchemaId: updatedConfig.supplierSchemaId,
      productSchemaId: updatedConfig.productSchemaId,
      orderSchemaId: updatedConfig.orderSchemaId,
    },
    completed,
  };
}

export async function syncAllEntities() {
  const [suppliers, products, orders] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.product.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.order.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const results = {
    suppliers: [] as RetailTraceSync[],
    products: [] as RetailTraceSync[],
    orders: [] as RetailTraceSync[],
  };

  for (const supplier of suppliers) {
    try {
      results.suppliers.push(await syncSupplier(supplier.id));
    } catch (error) {
      const sync = await prisma.retailTraceSync.findUnique({
        where: { entityType_localEntityId: { entityType: "Supplier", localEntityId: supplier.id } },
      });
      if (sync) results.suppliers.push(sync);
    }
  }
  for (const product of products) {
    try {
      results.products.push(await syncProduct(product.id));
    } catch {
      const sync = await prisma.retailTraceSync.findUnique({
        where: { entityType_localEntityId: { entityType: "Product", localEntityId: product.id } },
      });
      if (sync) results.products.push(sync);
    }
  }
  for (const order of orders) {
    try {
      results.orders.push(await syncOrder(order.id));
    } catch {
      const sync = await prisma.retailTraceSync.findUnique({
        where: { entityType_localEntityId: { entityType: "Order", localEntityId: order.id } },
      });
      if (sync) results.orders.push(sync);
    }
  }

  return results;
}

export async function getIntegrationStatus() {
  const [config, syncCounts] = await Promise.all([
    prisma.integrationConfig.findUnique({ where: { id: 1 } }),
    prisma.retailTraceSync.groupBy({
      by: ["syncStatus"],
      _count: { _all: true },
    }),
  ]);
  const hasSchemaIds = Boolean(
    config?.supplierSchemaId || config?.productSchemaId || config?.orderSchemaId,
  );
  const syncStatus = Object.fromEntries(
    syncCounts.map(({ syncStatus: status, _count }) => [status.toLowerCase(), _count._all]),
  );

  return {
    status: config?.initialized ? "initialized" : hasSchemaIds ? "partial" : "not_initialized",
    initialized: config?.initialized ?? false,
    schemas: {
      supplierSchemaId: config?.supplierSchemaId ?? null,
      productSchemaId: config?.productSchemaId ?? null,
      orderSchemaId: config?.orderSchemaId ?? null,
    },
    synchronization: {
      synced: syncStatus.synced ?? 0,
      failed: syncStatus.failed ?? 0,
      pending: syncStatus.pending ?? 0,
    },
    orderSynchronization: "implemented",
  };
}
