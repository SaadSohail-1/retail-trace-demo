import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import express from "express";
import type { RetailTraceSync } from "../generated/prisma/client.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createPublicVerificationRateLimit } from "../middleware/public-verification-rate-limit.js";
import { createPublicRouter } from "../routes/public.routes.js";
import { RetailTraceApiError } from "../services/integration-errors.js";
import {
  createPublicOrderLookupService,
  createPublicRecordLookupService,
  createPublicVerificationService,
  type PublicVerificationRepository,
} from "../services/public-verification.service.js";
import type {
  RetailTracePublicTransactionVerification,
  RetailTraceRecord,
} from "../services/retailtrace-api.service.js";

const recordId = "507f1f77bcf86cd799439011";
const transactionId = "real-blockchain-transaction";
const now = new Date("2026-03-04T10:00:00.000Z");

function createSync(overrides: Partial<RetailTraceSync> = {}): RetailTraceSync {
  return {
    id: "internal-sync-secret",
    entityType: "Order",
    localEntityId: "internal-order-secret",
    retailTraceRecordId: recordId,
    transactionId,
    retailTraceStatus: "CONFIRMED",
    submissionUncertain: false,
    submissionStartedAt: null,
    syncStatus: "SYNCED",
    errorMessage: "private@example.invalid",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createRepository(
  sync: RetailTraceSync | null,
  orderExists = true,
): PublicVerificationRepository {
  return {
    async findOrderSyncByRecordId() {
      return sync;
    },
    async findOrderById() {
      return orderExists
        ? {
            createdAt: now,
            total: { toFixed: () => "42.50" },
            items: [
              { quantity: 2, product: { name: "Cedar Oil" } },
              { quantity: 1, product: { name: "Oat Mask" } },
            ],
          }
        : null;
    },
  };
}

function createRetailTraceRecord(
  overrides: Partial<RetailTraceRecord> = {},
): RetailTraceRecord {
  return {
    recordId,
    businessId: "private-business-id",
    schemaId: "private-schema-id",
    data: { customerEmail: "private@example.invalid" },
    transactionId,
    status: "CONFIRMED",
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function createVerifiedTransaction(
  overrides: Partial<RetailTracePublicTransactionVerification> = {},
): RetailTracePublicTransactionVerification {
  return {
    status: "VERIFIED",
    transactionExists: true,
    recordFound: true,
    commitmentMatches: true,
    transactionId,
    publicationStatus: "CONFIRMED",
    network: "test-chain",
    recordId,
    streamName: "records",
    commitmentHash: `sha256:${"a".repeat(64)}`,
    confirmations: 3,
    blockHeight: 9876,
    publicationTimestamp: now.toISOString(),
    explanation: "verified",
    ...overrides,
  };
}

async function withPublicApi(
  router: express.Router,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use("/api/public", router);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("Public order verification", () => {
  it("returns an explicit safe order summary without customer or database identifiers", async () => {
    const lookupOrder = createPublicOrderLookupService(createRepository(createSync()));
    const data = await lookupOrder(recordId);
    assert.deepEqual(data, {
      status: "FOUND",
      orderReference: "ORD-0406FA3B4F",
      retailTraceRecordId: recordId,
      orderDate: now.toISOString(),
      products: [
        { name: "Cedar Oil", quantity: 2 },
        { name: "Oat Mask", quantity: 1 },
      ],
      total: "42.50",
      transactionId,
      publicationStatus: "CONFIRMED",
    });
    const serialized = JSON.stringify(data);
    assert.equal(serialized.includes("internal-order-secret"), false);
    assert.equal(serialized.includes("internal-sync-secret"), false);
    assert.equal(serialized.includes("private@example.invalid"), false);
  });

  it("only exposes a minimal RetailTrace record summary", async () => {
    const lookupRecord = createPublicRecordLookupService(
      createRepository(createSync()),
      {
        async getRecord() {
          return createRetailTraceRecord();
        },
      },
    );
    assert.deepEqual(await lookupRecord(recordId), {
      status: "FOUND",
      recordId,
      transactionId,
      publicationStatus: "CONFIRMED",
      publicationTimestamp: now.toISOString(),
    });
  });

  it("uses the actual transaction verification result even when saved status is stale", async () => {
    const repository = createRepository(createSync({
      retailTraceStatus: null,
      syncStatus: "FAILED",
    }));
    const verify = createPublicVerificationService(
      repository,
      {
        async getRecord() {
          return createRetailTraceRecord({ status: "PENDING" });
        },
        async verifyPublicTransaction() {
          return createVerifiedTransaction();
        },
      },
      () => now,
      () => "https://trace.example.com",
    );

    const result = await verify(recordId);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.transactionId, transactionId);
    assert.equal(result.blockHeight, 9876);
    assert.deepEqual(result.checks, {
      transactionExists: true,
      recordFound: true,
      commitmentMatches: true,
    });
    assert.equal(
      result.independentVerificationUrl,
      `https://trace.example.com/verify?txid=${transactionId}`,
    );
  });

  it("returns NOT_VERIFIED for missing, invalid, and non-order records", async () => {
    let remoteCalls = 0;
    const missing = createPublicVerificationService(
      createRepository(null),
      {
        async getRecord() {
          remoteCalls += 1;
          throw new Error("Must not fetch a missing record");
        },
        async verifyPublicTransaction() {
          remoteCalls += 1;
          throw new Error("Must not verify a missing record");
        },
      },
    );
    assert.equal((await missing(recordId)).status, "NOT_VERIFIED");
    assert.equal((await missing("invalid-id")).status, "NOT_VERIFIED");
    assert.equal(remoteCalls, 0);

    const supplierSync = createSync({ entityType: "Supplier" });
    const nonOrder = createPublicOrderLookupService(createRepository(supplierSync));
    assert.deepEqual(await nonOrder(recordId), { status: "NOT_FOUND" });
  });

  it("returns PENDING until an actual transaction ID is available", async () => {
    const verify = createPublicVerificationService(
      createRepository(createSync({
        retailTraceStatus: "PENDING",
        syncStatus: "PENDING",
        transactionId: null,
      })),
      {
        async getRecord() {
          return createRetailTraceRecord({
            status: "PENDING",
            transactionId: null,
          });
        },
        async verifyPublicTransaction() {
          throw new Error("Must not verify without a transaction ID");
        },
      },
      () => now,
    );
    assert.equal((await verify(recordId)).status, "PENDING");
  });

  it("does not mark a transaction as verified when the commitment check fails", async () => {
    const verify = createPublicVerificationService(
      createRepository(createSync()),
      {
        async getRecord() {
          return createRetailTraceRecord();
        },
        async verifyPublicTransaction() {
          return createVerifiedTransaction({
            status: "INTEGRITY_MISMATCH",
            commitmentMatches: false,
            explanation: "mismatch",
          });
        },
      },
      () => now,
    );
    const result = await verify(recordId);
    assert.equal(result.status, "NOT_VERIFIED");
    assert.equal(result.checks.commitmentMatches, false);
  });

  it("distinguishes publication pending and RetailTrace unavailability", async () => {
    const pending = createPublicVerificationService(
      createRepository(createSync()),
      {
        async getRecord() {
          return createRetailTraceRecord();
        },
        async verifyPublicTransaction() {
          return createVerifiedTransaction({
            status: "UNCONFIRMED",
            publicationStatus: "PENDING",
          });
        },
      },
      () => now,
    );
    assert.equal((await pending(recordId)).status, "PENDING");

    const unavailable = createPublicVerificationService(
      createRepository(createSync()),
      {
        async getRecord() {
          return createRetailTraceRecord();
        },
        async verifyPublicTransaction() {
          throw new RetailTraceApiError(
            502,
            "RETAILTRACE_UNAVAILABLE",
            "RetailTrace is unavailable",
            503,
          );
        },
      },
      () => now,
    );
    assert.equal((await unavailable(recordId)).status, "UNAVAILABLE");
    assert.deepEqual((await unavailable(recordId)).checks, {
      transactionExists: null,
      recordFound: null,
      commitmentMatches: null,
    });
  });

  it("serves public order lookup without authentication and applies rate limits", async () => {
    let calls = 0;
    const lookupOrder = createPublicOrderLookupService({
      ...createRepository(createSync()),
      async findOrderSyncByRecordId() {
        calls += 1;
        return createSync();
      },
    });
    const router = createPublicRouter(
      async () => {
        throw new Error("Not used in this test");
      },
      createPublicVerificationRateLimit({ maxRequests: 2, windowMs: 60_000 }),
      lookupOrder,
      async () => ({ status: "NOT_FOUND" }),
    );

    await withPublicApi(router, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/public/order/${recordId}`);
      const second = await fetch(`${baseUrl}/api/public/order/${recordId}`);
      const limited = await fetch(`${baseUrl}/api/public/order/${recordId}`);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.has("retry-after"), true);
      assert.equal(calls, 2);
      const body = await first.json() as { data: Record<string, unknown> };
      assert.equal(body.data.status, "FOUND");
      assert.equal("customerName" in body.data, false);
      assert.equal("localEntityId" in body.data, false);
    });
  });
});
