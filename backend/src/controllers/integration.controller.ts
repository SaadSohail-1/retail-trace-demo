import type { Request, Response } from "express";
import {
  getIntegrationStatus,
  initializeIntegration,
  syncAllEntities,
} from "../services/integration.service.js";
import { IntegrationError } from "../services/integration-errors.js";
import { retailTraceApi } from "../services/retailtrace-api.service.js";
import { retryFailedSync } from "../services/sync.service.js";

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
