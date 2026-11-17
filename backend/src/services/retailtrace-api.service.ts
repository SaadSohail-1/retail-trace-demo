import axios, { type AxiosError } from "axios";
import { env } from "../config/env.js";
import { RetailTraceApiError } from "./integration-errors.js";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface RetailTraceSchemaField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "reference";
  required: boolean;
  targetSchemaId?: string;
  multiple?: boolean;
}

export type RetailTraceRecordValue = string | number | boolean | string[];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fromAxiosError(error: AxiosError<unknown>): RetailTraceApiError {
  const upstreamStatus = error.response?.status ?? null;
  const responseBody = error.response?.data;
  const responseError =
    isRecord(responseBody) && isRecord(responseBody.error) ? responseBody.error : undefined;
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

client.interceptors.response.use(
  (response) => {
    if (isRecord(response.data) && response.data.success === false) {
      const bodyError = isRecord(response.data.error) ? response.data.error : undefined;
      const code = bodyError && typeof bodyError.code === "string" ? bodyError.code : undefined;
      const message =
        bodyError && typeof bodyError.message === "string"
          ? bodyError.message
          : "RetailTrace reported an unsuccessful response";
      throw new RetailTraceApiError(502, code ?? "RETAILTRACE_REQUEST_FAILED", message, response.status);
    }

    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      throw fromAxiosError(error);
    }
    throw error;
  },
);

export const retailTraceApi = {
  async checkHealth(): Promise<RetailTraceBlockchainHealth> {
    const response = await client.get<ApiEnvelope<RetailTraceBlockchainHealth>>(
      "/health/blockchain",
    );
    return response.data.data;
  },

  async listSchemas(): Promise<RetailTraceSchemaSummary[]> {
    const response = await client.get<ApiEnvelope<RetailTraceSchemaSummary[]>>("/schemas");
    return response.data.data;
  },

  async getSchema(schemaId: string): Promise<RetailTraceSchema> {
    const response = await client.get<ApiEnvelope<RetailTraceSchema>>(`/schemas/${schemaId}`);
    return response.data.data;
  },

  async createSchema(input: {
    name: string;
    fields: RetailTraceSchemaField[];
  }): Promise<RetailTraceSchemaSummary> {
    const response = await client.post<ApiEnvelope<RetailTraceSchemaSummary>>("/schemas", input);
    return response.data.data;
  },

  async updateSchema(
    schemaId: string,
    input: { name: string; fields: RetailTraceSchemaField[] },
  ): Promise<RetailTraceSchemaSummary> {
    const response = await client.put<ApiEnvelope<RetailTraceSchemaSummary>>(
      `/schemas/${schemaId}`,
      input,
    );
    return response.data.data;
  },

  async listRecords(): Promise<RetailTraceRecord[]> {
    const response = await client.get<ApiEnvelope<RetailTraceRecord[]>>("/records");
    return response.data.data;
  },

  async createRecord(input: {
    schemaId: string;
    data: Record<string, RetailTraceRecordValue>;
  }): Promise<RetailTraceRecord> {
    const response = await client.post<ApiEnvelope<RetailTraceRecord>>("/records", input);
    return response.data.data;
  },

  async verifyRecord(recordId: string): Promise<RetailTraceVerification> {
    const response = await client.get<ApiEnvelope<RetailTraceVerification>>(
      `/records/${recordId}/verify`,
    );
    return response.data.data;
  },
};
