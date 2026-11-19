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

function requiredParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IntegrationError(400, "INVALID_PARAMETER", `A valid ${name} is required`);
  }
  return value;
}

export async function getStatus(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await getIntegrationStatus() });
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

export async function compareSchema(request: Request, response: Response): Promise<void> {
  const entity = requiredParam(request.params.entity, "entity");
  if (!["Supplier", "Product", "Order"].includes(entity)) {
    throw new IntegrationError(400, "INVALID_ENTITY", "Entity must be Supplier, Product, or Order");
  }
  const schemaId = requiredParam(request.params.schemaId, "schemaId");
  const schema = await retailTraceApi.getSchema(schemaId);
  response.json({
    success: true,
    data: buildCompatibilityReport(entity as "Supplier" | "Product" | "Order", schema),
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
