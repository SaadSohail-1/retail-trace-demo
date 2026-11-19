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
  createPublicVerificationService,
  type PublicVerificationRepository,
} from "../services/public-verification.service.js";

const recordId = "507f1f77bcf86cd799439011";

function createSync(
  overrides: Partial<RetailTraceSync> = {},
): RetailTraceSync {
  const now = new Date();
  return {
    id: "internal-sync-secret",
    entityType: "Order",
    localEntityId: "internal-order-secret",
    retailTraceRecordId: recordId,
    transactionId: "real-blockchain-transaction",
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

function createRepository(sync: RetailTraceSync | null): PublicVerificationRepository {
  return {
    async findOrderSyncByRecordId() {
      return sync;
    },
  };
}

async function withPublicApi(
  verify: (id: string) => Promise<{
    status: "VERIFIED" | "NOT_VERIFIED" | "PENDING" | "UNAVAILABLE";
    orderReference?: string;
    publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
    transactionId?: string | null;
  }>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/public",
    createPublicRouter(
      verify,
      createPublicVerificationRateLimit({ maxRequests: 2, windowMs: 60_000 }),
    ),
  );
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
  it("verifies the RetailTrace record and returns only minimal public data", async () => {
    const verify = createPublicVerificationService(
      createRepository(createSync()),
      {
        async verifyRecord(id) {
          return {
            recordId: id,
            verified: true,
            transactionId: "real-blockchain-transaction",
          };
        },
      },
    );

    await withPublicApi(verify, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/public/verify/${recordId}`);
      const body = await response.json() as {
        success: boolean;
        data: Record<string, unknown>;
      };
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.deepEqual(body.data, {
        status: "VERIFIED",
        orderReference: "ORD-99439011",
        publicationStatus: "CONFIRMED",
        transactionId: "real-blockchain-transaction",
      });
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes("internal-sync-secret"), false);
      assert.equal(serialized.includes("internal-order-secret"), false);
      assert.equal(serialized.includes("private@example.invalid"), false);
    });
  });

  it("returns NOT_VERIFIED for missing, invalid, and non-order records", async () => {
    let lookups = 0;
    const missing = createPublicVerificationService(
      {
        async findOrderSyncByRecordId() {
          lookups += 1;
          return null;
        },
      },
      { async verifyRecord() { throw new Error("Must not verify a missing record"); } },
    );
    assert.deepEqual(await missing(recordId), { status: "NOT_VERIFIED" });
    assert.deepEqual(await missing("invalid-id"), { status: "NOT_VERIFIED" });
    assert.equal(lookups, 1);

    const supplierSync = createSync({ entityType: "Supplier" });
    const nonOrder = createPublicVerificationService(
      createRepository(supplierSync),
      { async verifyRecord() { throw new Error("Must not verify a non-order record"); } },
    );
    assert.deepEqual(await nonOrder(recordId), { status: "NOT_VERIFIED" });
  });

  it("returns PENDING until publication has completed", async () => {
    const pending = createPublicVerificationService(
      createRepository(createSync({
        retailTraceStatus: "PENDING",
        syncStatus: "PENDING",
        transactionId: null,
      })),
      { async verifyRecord() { throw new Error("Must not verify a pending record"); } },
    );
    assert.equal((await pending(recordId)).status, "PENDING");
  });

  it("returns NOT_VERIFIED when RetailTrace reports a failed commitment check", async () => {
    const failed = createPublicVerificationService(
      createRepository(createSync()),
      {
        async verifyRecord(id) {
          return { recordId: id, verified: false, transactionId: null };
        },
      },
    );
    assert.equal((await failed(recordId)).status, "NOT_VERIFIED");
  });

  it("uses the live verification result when stored publication status is outdated", async () => {
    const verify = createPublicVerificationService(
      createRepository(createSync({
        retailTraceStatus: null,
        syncStatus: "FAILED",
      })),
      {
        async verifyRecord(id) {
          return {
            recordId: id,
            verified: true,
            transactionId: "real-blockchain-transaction",
          };
        },
      },
    );

    assert.equal((await verify(recordId)).status, "VERIFIED");
  });

  it("rejects a verification result for a different RetailTrace record", async () => {
    const verify = createPublicVerificationService(
      createRepository(createSync()),
      {
        async verifyRecord() {
          return {
            recordId: "507f1f77bcf86cd799439012",
            verified: true,
            transactionId: "real-blockchain-transaction",
          };
        },
      },
    );

    assert.equal((await verify(recordId)).status, "NOT_VERIFIED");
  });

  it("returns UNAVAILABLE for a RetailTrace or blockchain outage", async () => {
    const unavailable = createPublicVerificationService(
      createRepository(createSync()),
      {
        async verifyRecord() {
          throw new RetailTraceApiError(
            502,
            "RETAILTRACE_UNAVAILABLE",
            "RetailTrace is unavailable",
            503,
          );
        },
      },
    );
    assert.equal((await unavailable(recordId)).status, "UNAVAILABLE");
  });

  it("rate limits the public endpoint without requiring authentication", async () => {
    let calls = 0;
    const verify = async () => {
      calls += 1;
      return { status: "VERIFIED" as const };
    };

    await withPublicApi(verify, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/public/verify/${recordId}`);
      const second = await fetch(`${baseUrl}/api/public/verify/${recordId}`);
      const limited = await fetch(`${baseUrl}/api/public/verify/${recordId}`);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.has("retry-after"), true);
      assert.equal(calls, 2);
    });
  });
});
