import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import axios from "axios";
import express from "express";
import {
  createRetailTraceApi,
  type RetailTraceRecord,
} from "../services/retailtrace-api.service.js";
import { RetailTraceApiError } from "../services/integration-errors.js";

async function withRetailTraceApi(
  configure: (app: express.Express) => void,
  run: (api: ReturnType<typeof createRetailTraceApi>) => Promise<void>,
  timeout = 5_000,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  try {
    await run(createRetailTraceApi(axios.create({
      baseURL: `http://127.0.0.1:${address.port}`,
      timeout,
    })));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function envelope(data: unknown) {
  return { success: true, data };
}

describe("RetailTrace API contract", () => {
  it("uses the current health, schema, record, and verification response envelopes", async () => {
    const record: RetailTraceRecord = {
      recordId: "507f1f77bcf86cd799439011",
      businessId: "business-1",
      schemaId: "schema-1",
      data: { name: "Calendula Balm" },
      transactionId: "tx-1",
      status: "CONFIRMED",
      createdAt: "2026-11-18T12:00:00.000Z",
    };
    let verifiedTransactionId = record.transactionId;
    const calls: string[] = [];

    await withRetailTraceApi((app) => {
      app.get("/health/blockchain", (_request, response) => {
        calls.push("GET /health/blockchain");
        response.json(envelope({ status: "connected", checkedAt: record.createdAt }));
      });
      app.get("/schemas", (_request, response) => {
        calls.push("GET /schemas");
        response.json(envelope([{ schemaId: "schema-1", name: "Supplier", version: 1 }]));
      });
      app.get("/schemas/schema-1", (_request, response) => {
        calls.push("GET /schemas/schema-1");
        response.json(envelope({
          schemaId: "schema-1",
          name: "Supplier",
          version: 1,
          fields: [],
          schema: { type: "object" },
        }));
      });
      app.post("/schemas", (request, response) => {
        calls.push(`POST /schemas ${request.body.name}`);
        response.status(201).json(envelope({
          schemaId: "schema-2",
          name: request.body.name,
          version: 1,
        }));
      });
      app.get("/records", (_request, response) => {
        calls.push("GET /records");
        response.json(envelope([record]));
      });
      app.post("/records", (request, response) => {
        calls.push(`POST /records ${request.body.schemaId}`);
        response.status(201).json(envelope({
          ...record,
          schemaId: request.body.schemaId,
          data: request.body.data,
        }));
      });
      app.get("/records/:recordId", (_request, response) => {
        calls.push("GET /records/507f1f77bcf86cd799439011");
        response.json(envelope(record));
      });
      app.get("/records/:recordId/verify", (_request, response) => {
        calls.push("GET /records/507f1f77bcf86cd799439011/verify");
        response.json(envelope({
          recordId: record.recordId,
          verified: true,
          transactionId: verifiedTransactionId,
        }));
      });
      app.get("/public/verify/:transactionId", (request, response) => {
        calls.push(`GET /public/verify/${request.params.transactionId}`);
        response.json(envelope({
          status: "VERIFIED",
          transactionExists: true,
          recordFound: true,
          commitmentMatches: true,
          transactionId: request.params.transactionId,
          publicationStatus: "CONFIRMED",
          network: "test-chain",
          recordId: record.recordId,
          streamName: "records",
          commitmentHash: `sha256:${"a".repeat(64)}`,
          confirmations: 3,
          blockHeight: 9876,
          publicationTimestamp: record.createdAt,
          explanation: "verified",
        }));
      });
    }, async (api) => {
      assert.equal((await api.checkHealth()).status, "connected");
      assert.deepEqual(await api.listSchemas(), [
        { schemaId: "schema-1", name: "Supplier", version: 1 },
      ]);
      assert.equal((await api.getSchema("schema-1")).schemaId, "schema-1");
      assert.equal((await api.createSchema({ name: "Product", fields: [] })).schemaId, "schema-2");
      assert.deepEqual(await api.listRecords(), [record]);
      assert.equal((await api.getRecord(record.recordId)).recordId, record.recordId);
      assert.equal((await api.createRecord({
        schemaId: "schema-1",
        data: { name: "Calendula Balm" },
      })).transactionId, "tx-1");
      assert.deepEqual(await api.verifyRecord(record.recordId), {
        recordId: record.recordId,
        verified: true,
        transactionId: "tx-1",
      });
      const publicVerification = await api.verifyPublicTransaction("a".repeat(64));
      assert.equal(publicVerification.status, "VERIFIED");
      assert.equal(publicVerification.blockHeight, 9876);
      assert.deepEqual(await api.verifyTransaction("tx-1"), {
        recordId: record.recordId,
        verified: true,
        transactionId: "tx-1",
      });
      verifiedTransactionId = "tx-newer";
      assert.deepEqual(await api.verifyTransaction("tx-1"), {
        recordId: record.recordId,
        verified: false,
        transactionId: "tx-newer",
      });
      assert.equal(await api.verifyTransaction("missing"), null);
    });

    assert.ok(calls.includes("POST /schemas Product"));
    assert.ok(calls.includes("POST /records schema-1"));
    assert.ok(calls.includes("GET /records/507f1f77bcf86cd799439011/verify"));
    assert.ok(calls.includes(`GET /public/verify/${"a".repeat(64)}`));
  });

  it("accepts pending publication without a transaction ID and rejects false confirmation", async () => {
    let responseRecord: RetailTraceRecord = {
      recordId: "507f1f77bcf86cd799439011",
      businessId: "business-1",
      schemaId: "schema-1",
      data: {},
      transactionId: null,
      status: "PENDING",
      createdAt: "2026-11-18T12:00:00.000Z",
    };
    await withRetailTraceApi((app) => {
      app.post("/records", (_request, response) => response.status(201).json(envelope(responseRecord)));
    }, async (api) => {
      assert.equal((await api.createRecord({ schemaId: "schema-1", data: {} })).status, "PENDING");
      responseRecord = { ...responseRecord, status: "CONFIRMED" };
      await assert.rejects(
        api.createRecord({ schemaId: "schema-1", data: {} }),
        (error: unknown) =>
          error instanceof Error && error.message === "RetailTrace returned an unexpected response",
      );
    });
  });

  it("maps network timeouts without exposing request credentials", async () => {
    await withRetailTraceApi((app) => {
      app.get("/health/blockchain", (_request, response) => {
        setTimeout(() => response.json(envelope({
          status: "connected",
          checkedAt: new Date().toISOString(),
        })), 50);
      });
    }, async (api) => {
      await assert.rejects(api.checkHealth(), (error: unknown) => {
        assert.ok(error instanceof RetailTraceApiError);
        assert.equal(error.code, "RETAILTRACE_TIMEOUT");
        assert.ok(!JSON.stringify(error).includes("Authorization"));
        return true;
      });
    }, 5);
  });

  it("maps RetailTrace error envelopes and HTTP status without returning raw response bodies", async () => {
    await withRetailTraceApi((app) => {
      app.get("/records", (_request, response) => {
        response.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication is required" },
        });
      });
    }, async (api) => {
      await assert.rejects(api.listRecords(), (error: unknown) => {
        assert.ok(error instanceof RetailTraceApiError);
        assert.equal(error.code, "UNAUTHORIZED");
        assert.equal(error.message, "Authentication is required");
        assert.ok(!JSON.stringify(error).includes("Bearer"));
        return true;
      });
    });
  });
});
