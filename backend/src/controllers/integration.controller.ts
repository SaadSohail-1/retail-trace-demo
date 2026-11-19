import type { Request, Response } from "express";
import {
  getIntegrationStatus,
  initializeIntegration,
  syncAllEntities,
} from "../services/integration.service.js";
import { IntegrationError } from "../services/integration-errors.js";
import { retailTraceApi } from "../services/retailtrace-api.service.js";
import { retryFailedSync } from "../services/sync.service.js";
import { buildCompatibilityReport } from "../services/schema-compatibility.service.js";
import {
  getPrismaModels,
  type StoredSchemaMapping,
} from "../services/schema-compatibility.service.js";
import { prisma } from "../config/database.js";
import type { Prisma } from "../generated/prisma/client.js";

function requiredParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IntegrationError(400, "INVALID_PARAMETER", `A valid ${name} is required`);
  }
  return value;
}

function isDatabaseSetupFailure(error: unknown): boolean {
  const pending = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof candidate.code === "string" && /^(P1001|P1002|P2021|P2022|ECONNREFUSED|ETIMEDOUT)$/.test(candidate.code)) return true;
      if (typeof candidate.message === "string" && /connection refused|can't reach database|database server is not reachable|relation .* does not exist|column .* does not exist|connection terminated/i.test(candidate.message)) return true;
      pending.push(candidate.cause);
    }
  }
  return false;
}

export async function getStatus(_request: Request, response: Response): Promise<void> {
  try {
    response.json({ success: true, data: await getIntegrationStatus() });
  } catch (error) {
    if (isDatabaseSetupFailure(error)) {
      response.status(503).json({
        success: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Verdant’s PostgreSQL database could not be reached or is missing migrations. Start the postgres service and run `npx prisma migrate deploy` in backend, then retry.",
        },
      });
      return;
    }
    throw error;
  }
}

export async function getHealth(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await retailTraceApi.checkHealth() });
}

export async function initialize(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await initializeIntegration() });
}

export async function syncAll(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await syncAllEntities() });
}

export async function getSchemas(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await retailTraceApi.listSchemas() });
}

export async function getSchema(request: Request, response: Response): Promise<void> {
  response.json({
    success: true,
    data: await retailTraceApi.getSchema(requiredParam(request.params.schemaId, "schemaId")),
  });
}

export async function uploadSchema(request: Request, response: Response): Promise<void> {
  const body = request.body;
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.fields)
  ) {
    throw new IntegrationError(
      400,
      "INVALID_SCHEMA",
      'Expected { "name": "...", "fields": [...] }',
    );
  }
  response.status(201).json({
    success: true,
    data: await retailTraceApi.createSchema({
      name: body.name,
      fields: body.fields,
    }),
  });
}

function isMappingRecord(value: unknown): value is Record<string, StoredSchemaMapping> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredMapping(value: unknown): value is StoredSchemaMapping {
  return (
    typeof value === "object" &&
    value !== null &&
    "modelName" in value &&
    typeof value.modelName === "string" &&
    "fieldMappings" in value &&
    typeof value.fieldMappings === "object" &&
    value.fieldMappings !== null &&
    !Array.isArray(value.fieldMappings)
  );
}

async function loadSchemaMappings(): Promise<Record<string, StoredSchemaMapping>> {
  const config = await prisma.integrationConfig.findUnique({ where: { id: 1 } });
  if (!config || !isMappingRecord(config.schemaMappings)) return {};
  return Object.fromEntries(
    Object.entries(config.schemaMappings).filter(([, mapping]) => isStoredMapping(mapping)),
  ) as Record<string, StoredSchemaMapping>;
}

function readMappingRequest(body: unknown): StoredSchemaMapping {
  if (
    typeof body !== "object" ||
    body === null ||
    !("modelName" in body) ||
    typeof body.modelName !== "string" ||
    !("fieldMappings" in body) ||
    typeof body.fieldMappings !== "object" ||
    body.fieldMappings === null ||
    Array.isArray(body.fieldMappings) ||
    !Object.values(body.fieldMappings).every((field) => typeof field === "string")
  ) {
    throw new IntegrationError(
      400,
      "INVALID_SCHEMA_MAPPING",
      "Expected modelName and a fieldMappings object of Prisma field to RetailTrace field names",
    );
  }
  const mapping = { modelName: body.modelName, fieldMappings: body.fieldMappings as Record<string, string> };
  if (new Set(Object.values(mapping.fieldMappings)).size !== Object.values(mapping.fieldMappings).length) {
    throw new IntegrationError(400, "INVALID_SCHEMA_MAPPING", "Each RetailTrace field can be mapped only once");
  }
  return mapping;
}

export async function listDatabaseModels(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await getPrismaModels() });
}

export async function getSchemaMapping(request: Request, response: Response): Promise<void> {
  const schemaId = requiredParam(request.params.schemaId, "schemaId");
  await retailTraceApi.getSchema(schemaId);
  const mappings = await loadSchemaMappings();
  response.json({ success: true, data: mappings[schemaId] ?? null });
}

export async function saveSchemaMapping(request: Request, response: Response): Promise<void> {
  const schemaId = requiredParam(request.params.schemaId, "schemaId");
  const [schema, models, mappings] = await Promise.all([
    retailTraceApi.getSchema(schemaId),
    getPrismaModels(),
    loadSchemaMappings(),
  ]);
  const mapping = readMappingRequest(request.body);
  const model = models.find((candidate) => candidate.entity === mapping.modelName);
  if (!model) {
    throw new IntegrationError(400, "INVALID_MODEL", `Unknown Prisma model '${mapping.modelName}'`);
  }
  const invalidDatabaseField = Object.keys(mapping.fieldMappings).find(
    (fieldName) => !model.fields.some((field) => field.name === fieldName),
  );
  if (invalidDatabaseField) {
    throw new IntegrationError(400, "INVALID_FIELD_MAPPING", `Prisma field '${invalidDatabaseField}' does not exist on ${model.entity}`);
  }
  const invalidRetailTraceField = Object.values(mapping.fieldMappings).find(
    (fieldName) => !schema.fields.some((field) => field.name === fieldName),
  );
  if (invalidRetailTraceField) {
    throw new IntegrationError(400, "INVALID_FIELD_MAPPING", `RetailTrace field '${invalidRetailTraceField}' does not exist on ${schema.name}`);
  }
  const nextMappings = { ...mappings, [schemaId]: mapping };
  await prisma.integrationConfig.upsert({
    where: { id: 1 },
    create: { id: 1, schemaMappings: nextMappings as unknown as Prisma.InputJsonValue },
    update: { schemaMappings: nextMappings as unknown as Prisma.InputJsonValue },
  });
  response.json({ success: true, data: mapping });
}

export async function compareSchema(request: Request, response: Response): Promise<void> {
  const schemaId = requiredParam(request.params.schemaId, "schemaId");
  const [schema, models, mappings, allSchemas] = await Promise.all([
    retailTraceApi.getSchema(schemaId),
    getPrismaModels(),
    loadSchemaMappings(),
    retailTraceApi.listSchemas(),
  ]);
  const inputMapping = readMappingRequest(request.body);
  const model = models.find((candidate) => candidate.entity === inputMapping.modelName);
  if (!model) {
    throw new IntegrationError(400, "INVALID_MODEL", `Unknown Prisma model '${inputMapping.modelName}'`);
  }
  const targetSchemaModels: Record<string, string> = {};
  for (const [id, savedMapping] of Object.entries(mappings)) {
    targetSchemaModels[id] = savedMapping.modelName;
  }
  for (const summary of allSchemas) {
    const exactModel = models.find(
      (candidate) => candidate.entity.toLowerCase() === summary.name.toLowerCase(),
    );
    if (exactModel && targetSchemaModels[summary.schemaId] === undefined) {
      targetSchemaModels[summary.schemaId] = exactModel.entity;
    }
  }
  const saved = mappings[schemaId];
  const configurationSaved = saved?.modelName === inputMapping.modelName &&
    JSON.stringify(saved.fieldMappings) === JSON.stringify(inputMapping.fieldMappings);
  response.json({
    success: true,
    data: buildCompatibilityReport(
      model,
      schema,
      inputMapping.fieldMappings,
      targetSchemaModels,
      configurationSaved,
    ),
  });
}

export async function getRecords(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await retailTraceApi.listRecords() });
}

export async function retrySync(request: Request, response: Response): Promise<void> {
  response.json({
    success: true,
    data: await retryFailedSync(requiredParam(request.params.syncId, "syncId")),
  });
}

export async function verifyRecord(request: Request, response: Response): Promise<void> {
  response.json({
    success: true,
    data: await retailTraceApi.verifyRecord(requiredParam(request.params.recordId, "recordId")),
  });
}

export async function verifyTransaction(
  request: Request,
  response: Response,
): Promise<void> {
  const transactionId = requiredParam(
    request.params.transactionId,
    "transactionId",
  );
  const verification = await retailTraceApi.verifyTransaction(transactionId);
  if (!verification) {
    throw new IntegrationError(
      404,
      "TRANSACTION_RECORD_NOT_FOUND",
      "No RetailTrace record matches this transaction ID",
    );
  }

  response.json({ success: true, data: verification });
}
