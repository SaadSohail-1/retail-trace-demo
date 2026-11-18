import axios from "axios";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface IntegrationStatus {
  status: "initialized" | "partial" | "not_initialized";
  initialized: boolean;
  schemas: {
    supplierSchemaId: string | null;
    productSchemaId: string | null;
    orderSchemaId: string | null;
  };
  synchronization: {
    synced: number;
    failed: number;
    pending: number;
  };
  orderSynchronization: "implemented" | "pending_design";
}

export interface BlockchainHealth {
  status: "connected" | "unavailable" | "unknown";
  checkedAt: string;
}

export interface SchemaSummary {
  schemaId: string;
  name: string;
  version: number;
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

export interface InitializationResult {
  status: "initialized" | "partial" | "failed";
  initialized: boolean;
  schemas: IntegrationStatus["schemas"];
  completed: string[];
  failedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface SyncResult {
  id: string;
  entityType: string;
  localEntityId: string;
  retailTraceRecordId: string | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED";
  retailTraceStatus: "PENDING" | "CONFIRMED" | "FAILED" | null;
  submissionUncertain: boolean;
  errorMessage: string | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierView {
  supplier: {
    id: string;
    name: string;
    email: string;
    country: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  };
  synchronization: SyncResult | null;
}

export interface ProductView {
  product: {
    id: string;
    name: string;
    price: string;
    stockQuantity: number;
    organic: boolean;
    manufacturedOn: string;
  };
  supplier: {
    id: string;
    name: string;
    country: string;
  };
  synchronization: SyncResult | null;
}

export interface OrderView {
  order: {
    id: string;
    customerName: string;
    total: string;
    status: string;
    createdAt: string;
  };
  items: Array<{
    orderItem: { quantity: number; unitPrice: string };
    product: ProductView["product"];
  }>;
  synchronization: SyncResult | null;
}

export interface VerificationResult {
  recordId: string;
  verified: boolean;
  transactionId: string | null;
}

function parseVerification(value: unknown): VerificationResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("recordId" in value) ||
    typeof value.recordId !== "string" ||
    !("verified" in value) ||
    typeof value.verified !== "boolean" ||
    !("transactionId" in value) ||
    (value.transactionId !== null && typeof value.transactionId !== "string")
  ) {
    throw new Error("RetailTrace returned an invalid verification response.");
  }
  return {
    recordId: value.recordId,
    verified: value.verified,
    transactionId: value.transactionId,
  };
}

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5001",
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (typeof body === "object" && body !== null && "error" in body) {
      const apiError = body.error;
      if (
        typeof apiError === "object" &&
        apiError !== null &&
        "message" in apiError &&
        typeof apiError.message === "string"
      ) {
        return apiError.message;
      }
    }
    return error.message || "The business backend could not be reached.";
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export const api = {
  async getSuppliers(): Promise<SupplierView[]> {
    const response = await client.get<ApiResponse<SupplierView[]>>("/api/suppliers");
    return response.data.data;
  },

  async getProducts(): Promise<ProductView[]> {
    const response = await client.get<ApiResponse<ProductView[]>>("/api/products");
    return response.data.data;
  },

  async getOrders(): Promise<OrderView[]> {
    const response = await client.get<ApiResponse<OrderView[]>>("/api/orders");
    return response.data.data;
  },

  async getOrder(orderId: string): Promise<OrderView> {
    const response = await client.get<ApiResponse<OrderView>>(
      `/api/orders/${encodeURIComponent(orderId)}`,
    );
    return response.data.data;
  },

  async createOrder(customerName: string, productId: string): Promise<OrderView> {
    const response = await client.post<ApiResponse<OrderView>>("/api/orders", {
      customerName,
      items: [{ productId, quantity: 1 }],
    });
    return response.data.data;
  },

  async getIntegrationStatus(): Promise<IntegrationStatus> {
    const response = await client.get<ApiResponse<IntegrationStatus>>("/api/integration/status");
    return response.data.data;
  },

  async getHealth(): Promise<BlockchainHealth> {
    const response = await client.get<ApiResponse<BlockchainHealth>>("/api/integration/health");
    return response.data.data;
  },

  async getSchemas(): Promise<SchemaSummary[]> {
    const response = await client.get<ApiResponse<SchemaSummary[]>>("/api/integration/schemas");
    return response.data.data;
  },

  async getRecords(): Promise<RetailTraceRecord[]> {
    const response = await client.get<ApiResponse<RetailTraceRecord[]>>("/api/integration/records");
    return response.data.data;
  },

  async initialize(): Promise<InitializationResult> {
    const response = await client.post<ApiResponse<InitializationResult>>(
      "/api/integration/initialize",
    );
    return response.data.data;
  },

  async syncAll(): Promise<{
    suppliers: SyncResult[];
    products: SyncResult[];
    orders: SyncResult[];
  }> {
    const response = await client.post<ApiResponse<{
      suppliers: SyncResult[];
      products: SyncResult[];
      orders: SyncResult[];
    }>>("/api/integration/sync-all");
    return response.data.data;
  },

  async retry(syncId: string): Promise<SyncResult> {
    const response = await client.post<ApiResponse<SyncResult>>(
      `/api/integration/retry/${encodeURIComponent(syncId)}`,
    );
    return response.data.data;
  },

  async verify(recordId: string): Promise<VerificationResult> {
    const response = await client.get<ApiResponse<VerificationResult>>(
      `/api/integration/records/${encodeURIComponent(recordId)}/verify`,
    );
    return parseVerification(response.data?.data);
  },

  async verifyByTransaction(transactionId: string): Promise<VerificationResult> {
    const response = await client.get<ApiResponse<VerificationResult>>(
      `/api/integration/transactions/${encodeURIComponent(transactionId)}/verify`,
    );
    return parseVerification(response.data?.data);
  },
};
