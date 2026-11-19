import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
} from "axios";
import { env } from "../config/env.js";
import { IntegrationError, RetailTraceApiError } from "./integration-errors.js";

export interface RetailTraceSchemaField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "reference";
  required: boolean;
  targetSchemaId?: string;
  multiple?: boolean;
}

export type RetailTraceRecordValue = string | number | boolean;

export interface RetailTraceSchemaSummary {
  schemaId: string;
  name: string;
  version: number;
}

export interface RetailTraceSchema extends RetailTraceSchemaSummary {
  fields: RetailTraceSchemaField[];
  schema: Record<string, unknown>;
}

export interface RetailTraceRecord {
  recordId: string;
  businessId: string;
  schemaId: string;
  data: Record<string, unknown>;
  transactionId: string | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  createdAt: string;
}

export interface RetailTraceVerification {
  recordId: string;
  verified: boolean;
  transactionId: string | null;
}

export interface RetailTracePublicTransactionVerification {
  status:
    | "VERIFIED"
    | "TRANSACTION_NOT_FOUND"
    | "RECORD_NOT_FOUND"
    | "INTEGRITY_MISMATCH"
    | "UNCONFIRMED"
    | "UNAVAILABLE";
  transactionExists: boolean | null;
  recordFound: boolean | null;
  commitmentMatches: boolean | null;
  transactionId: string;
  publicationStatus: "CONFIRMED" | "PENDING" | "FAILED" | "UNKNOWN";
  network: string;
  recordId?: string;
  streamName?: string;
  commitmentHash?: string;
  confirmations?: number;
  blockHeight?: number;
  publicationTimestamp?: string;
  explanation: string;
}

export interface RetailTraceBlockchainHealth {
  status: "connected" | "unavailable" | "unknown";
  checkedAt: string;
}

const client = axios.create({
  baseURL: env.retailTraceBaseUrl,
  timeout: 10_000,
  headers: {
    Authorization: `Bearer ${env.retailTraceApiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

const publicClient = axios.create({
  baseURL: env.retailTraceBaseUrl,
  timeout: 10_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromAxiosError(error: AxiosError<unknown>): RetailTraceApiError {
  const upstreamStatus = error.response?.status ?? null;
  const responseBody = error.response?.data;
  const responseError =
    isObject(responseBody) && isObject(responseBody.error) ? responseBody.error : undefined;
  const upstreamCode =
    responseError && typeof responseError.code === "string" ? responseError.code : undefined;
  const upstreamMessage =
    responseError && typeof responseError.message === "string"
      ? responseError.message
      : undefined;

  if (upstreamStatus === null) {
    const timedOut = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
    return new RetailTraceApiError(
      timedOut ? 504 : 503,
      timedOut ? "RETAILTRACE_TIMEOUT" : "RETAILTRACE_UNAVAILABLE",
      timedOut ? "RetailTrace request timed out" : "RetailTrace could not be reached",
      null,
    );
  }

  return new RetailTraceApiError(
    502,
    upstreamCode ?? "RETAILTRACE_REQUEST_FAILED",
    upstreamMessage ?? `RetailTrace returned HTTP ${upstreamStatus}`,
    upstreamStatus,
  );
}

function invalidResponse(): RetailTraceApiError {
  return new RetailTraceApiError(
    502,
    "RETAILTRACE_INVALID_RESPONSE",
    "RetailTrace returned an unexpected response",
    null,
  );
}

async function requestData<T>(
  request: Promise<AxiosResponse<unknown>>,
  validate: (value: unknown) => value is T,
): Promise<T> {
  try {
    const response = await request;
    const body = response.data;
    if (!isObject(body)) {
      throw invalidResponse();
    }
    if (body.success === false) {
      const error = isObject(body.error) ? body.error : undefined;
      throw new RetailTraceApiError(
        502,
        typeof error?.code === "string" ? error.code : "RETAILTRACE_REQUEST_FAILED",
        typeof error?.message === "string"
          ? error.message
          : "RetailTrace reported an unsuccessful response",
        response.status,
      );
    }
    if (body.success !== true || !validate(body.data)) {
      throw invalidResponse();
    }
    return body.data;
  } catch (error) {
    if (error instanceof IntegrationError) {
      throw error;
    }
    if (axios.isAxiosError(error)) {
      throw fromAxiosError(error);
    }
    throw error;
  }
}

function isRecordSummary(value: unknown): value is RetailTraceSchemaSummary {
  return (
    isObject(value) &&
    typeof value.schemaId === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number"
  );
}

function isSchema(value: unknown): value is RetailTraceSchema {
  return (
    isObject(value) &&
    isRecordSummary(value) &&
    Array.isArray(value.fields) &&
    value.fields.every(isSchemaField) &&
    isObject(value.schema)
  );
}

function isSchemaField(value: unknown): value is RetailTraceSchemaField {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    (value.type === "string" ||
      value.type === "number" ||
      value.type === "integer" ||
      value.type === "boolean" ||
      value.type === "date" ||
      value.type === "reference") &&
    typeof value.required === "boolean" &&
    (value.multiple === undefined || typeof value.multiple === "boolean") &&
    (value.type !== "reference" || typeof value.targetSchemaId === "string")
  );
}

function isRetailTraceRecord(value: unknown): value is RetailTraceRecord {
  return (
    isObject(value) &&
    typeof value.recordId === "string" &&
    typeof value.businessId === "string" &&
    typeof value.schemaId === "string" &&
    isObject(value.data) &&
    (value.transactionId === null || typeof value.transactionId === "string") &&
    (value.status === "PENDING" || value.status === "CONFIRMED" || value.status === "FAILED") &&
    typeof value.createdAt === "string"
  );
}

function isVerification(value: unknown): value is RetailTraceVerification {
  return (
    isObject(value) &&
    typeof value.recordId === "string" &&
    typeof value.verified === "boolean" &&
    (value.transactionId === null || typeof value.transactionId === "string")
  );
}

function isHealth(value: unknown): value is RetailTraceBlockchainHealth {
  return (
    isObject(value) &&
    (value.status === "connected" || value.status === "unavailable" || value.status === "unknown") &&
    typeof value.checkedAt === "string"
  );
}

function isPublicTransactionVerification(
  value: unknown,
): value is RetailTracePublicTransactionVerification {
  return (
    isObject(value) &&
    (value.status === "VERIFIED" ||
      value.status === "TRANSACTION_NOT_FOUND" ||
      value.status === "RECORD_NOT_FOUND" ||
      value.status === "INTEGRITY_MISMATCH" ||
      value.status === "UNCONFIRMED" ||
      value.status === "UNAVAILABLE") &&
    (value.transactionExists === null || typeof value.transactionExists === "boolean") &&
    (value.recordFound === null || typeof value.recordFound === "boolean") &&
    (value.commitmentMatches === null || typeof value.commitmentMatches === "boolean") &&
    typeof value.transactionId === "string" &&
    (value.publicationStatus === "CONFIRMED" ||
      value.publicationStatus === "PENDING" ||
      value.publicationStatus === "FAILED" ||
      value.publicationStatus === "UNKNOWN") &&
    typeof value.network === "string" &&
    (!("recordId" in value) || typeof value.recordId === "string") &&
    (!("streamName" in value) || typeof value.streamName === "string") &&
    (!("commitmentHash" in value) || typeof value.commitmentHash === "string") &&
    (!("confirmations" in value) || typeof value.confirmations === "number") &&
    (!("blockHeight" in value) || typeof value.blockHeight === "number") &&
    (!("publicationTimestamp" in value) || typeof value.publicationTimestamp === "string") &&
    typeof value.explanation === "string"
  );
}

export function createRetailTraceApi(http: AxiosInstance = client) {
  const publicHttp = http === client ? publicClient : http;
  return {
    async checkHealth(): Promise<RetailTraceBlockchainHealth> {
      return requestData(http.get("/health/blockchain"), isHealth);
    },

    async listSchemas(): Promise<RetailTraceSchemaSummary[]> {
      return requestData(
        http.get("/schemas"),
        (value): value is RetailTraceSchemaSummary[] =>
          Array.isArray(value) && value.every(isRecordSummary),
      );
    },

    async getSchema(schemaId: string): Promise<RetailTraceSchema> {
      return requestData(http.get(`/schemas/${encodeURIComponent(schemaId)}`), isSchema);
    },

    async createSchema(input: {
      name: string;
      fields: RetailTraceSchemaField[];
    }): Promise<RetailTraceSchemaSummary> {
      return requestData(http.post("/schemas", input), isRecordSummary);
    },

    async listRecords(): Promise<RetailTraceRecord[]> {
      return requestData(
        http.get("/records"),
        (value): value is RetailTraceRecord[] =>
          Array.isArray(value) && value.every(isRetailTraceRecord),
      );
    },

    async getRecord(recordId: string): Promise<RetailTraceRecord> {
      return requestData(
        http.get(`/records/${encodeURIComponent(recordId)}`),
        isRetailTraceRecord,
      );
    },

    async createRecord(input: {
      schemaId: string;
      data: Record<string, RetailTraceRecordValue>;
    }): Promise<RetailTraceRecord> {
      const record = await requestData(
        http.post("/records", input),
        isRetailTraceRecord,
      );
      if (record.status === "CONFIRMED" && !record.transactionId) {
        throw invalidResponse();
      }
      return record;
    },

    async verifyRecord(recordId: string): Promise<RetailTraceVerification> {
      return requestData(
        http.get(`/records/${encodeURIComponent(recordId)}/verify`),
        isVerification,
      );
    },

    async verifyPublicTransaction(
      transactionId: string,
    ): Promise<RetailTracePublicTransactionVerification> {
      return requestData(
        publicHttp.get(`/public/verify/${encodeURIComponent(transactionId)}`),
        isPublicTransactionVerification,
      );
    },

    async verifyTransaction(transactionId: string): Promise<RetailTraceVerification | null> {
      const records = await this.listRecords();
      const record = records.find((item) => item.transactionId === transactionId);
      if (!record) {
        return null;
      }
      const verification = await this.verifyRecord(record.recordId);
      return {
        ...verification,
        verified:
          verification.verified && verification.transactionId === transactionId,
      };
    },
  };
}

export const retailTraceApi = createRetailTraceApi();
