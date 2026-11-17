import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import express from "express";
import type { RetailTraceSync, Supplier } from "../generated/prisma/client.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createSupplierRouter } from "../routes/supplier.routes.js";
import {
  createSupplierService,
  type SupplierRepository,
  type SupplierView,
} from "../services/supplier.service.js";
import { RetailTraceApiError } from "../services/integration-errors.js";

function createInMemoryRepository() {
  const entries: SupplierView[] = [];
  let nextId = 0;
  const repository: SupplierRepository = {
    async createWithPendingSync(input) {
      nextId += 1;
      const now = new Date();
      const supplier: Supplier = {
        id: `supplier-${nextId}`,
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      const synchronization: RetailTraceSync = {
        id: `sync-${nextId}`,
        entityType: "Supplier",
        localEntityId: supplier.id,
        retailTraceRecordId: null,
        syncStatus: "PENDING",
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      const entry = { supplier, synchronization };
      entries.push(entry);
      return entry;
    },
    async list() {
      return [...entries];
    },
    async get(id) {
      return entries.find(({ supplier }) => supplier.id === id) ?? null;
    },
  };
  return { repository, entries };
}

async function withSupplierApi(
  service: ReturnType<typeof createSupplierService>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/suppliers", createSupplierRouter(service));
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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const supplierInput = {
  name: "Green Valley Botanicals",
  email: "hello@greenvalley.example",
  country: "Canada",
};

describe("Supplier API", () => {
  it("creates a local Supplier and returns its successful RetailTrace mapping", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createSupplierService(repository, async (supplierId) => {
      const entry = entries.find(({ supplier }) => supplier.id === supplierId);
      assert.ok(entry?.synchronization);
      entry.synchronization.retailTraceRecordId = "507f1f77bcf86cd799439011";
      entry.synchronization.syncStatus = "SYNCED";
      return entry.synchronization;
    });

    await withSupplierApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/suppliers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(supplierInput),
      });
      const body = await readJson(response);
      const data = body.data as SupplierView;

      assert.equal(response.status, 201);
      assert.equal(body.success, true);
      assert.equal(data.supplier.id, "supplier-1");
      assert.equal(data.supplier.active, true);
      assert.equal(data.synchronization?.retailTraceRecordId, "507f1f77bcf86cd799439011");
      assert.equal(data.synchronization?.syncStatus, "SYNCED");
    });
  });

  it("rejects invalid supplier input without saving local data", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createSupplierService(repository, async () => {
      throw new Error("Synchronization must not run for invalid input");
    });

    await withSupplierApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/suppliers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...supplierInput, email: "not-an-email" }),
      });
      const body = await readJson(response);
      const error = body.error as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(error.code, "INVALID_SUPPLIER");
      assert.equal(entries.length, 0);
    });
  });

  it("preserves a local Supplier and exposes failed sync state when RetailTrace is unavailable", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createSupplierService(repository, async (supplierId) => {
      const entry = entries.find(({ supplier }) => supplier.id === supplierId);
      assert.ok(entry?.synchronization);
      entry.synchronization.syncStatus = "FAILED";
      entry.synchronization.errorMessage = "RETAILTRACE_UNAVAILABLE: RetailTrace could not be reached";
      throw new RetailTraceApiError(
        503,
        "RETAILTRACE_UNAVAILABLE",
        "RetailTrace could not be reached",
        null,
      );
    });

    await withSupplierApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/suppliers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(supplierInput),
      });
      const body = await readJson(response);
      const data = body.data as SupplierView;

      assert.equal(response.status, 201);
      assert.equal(entries.length, 1);
      assert.equal(data.supplier.id, "supplier-1");
      assert.equal(data.synchronization?.syncStatus, "FAILED");
      assert.equal(data.synchronization?.retailTraceRecordId, null);
      assert.match(data.synchronization?.errorMessage ?? "", /RETAILTRACE_UNAVAILABLE/);
    });
  });

  it("lists suppliers and returns a not-found response for an unknown ID", async () => {
    const { repository } = createInMemoryRepository();
    const service = createSupplierService(repository, async (supplierId) => {
      const entry = await repository.get(supplierId);
      assert.ok(entry?.synchronization);
      entry.synchronization.syncStatus = "SYNCED";
      return entry.synchronization;
    });

    await service.create({ ...supplierInput, active: true });

    await withSupplierApi(service, async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/suppliers`);
      const listBody = await readJson(listResponse);
      const list = listBody.data as SupplierView[];
      assert.equal(listResponse.status, 200);
      assert.equal(list.length, 1);
      assert.equal(list[0]?.supplier.id, "supplier-1");

      const getResponse = await fetch(`${baseUrl}/api/suppliers/supplier-1`);
      const getBody = await readJson(getResponse);
      const detail = getBody.data as SupplierView;
      assert.equal(getResponse.status, 200);
      assert.equal(detail.supplier.id, "supplier-1");

      const notFoundResponse = await fetch(`${baseUrl}/api/suppliers/missing`);
      const notFoundBody = await readJson(notFoundResponse);
      const error = notFoundBody.error as Record<string, unknown>;
      assert.equal(notFoundResponse.status, 404);
      assert.equal(error.code, "SUPPLIER_NOT_FOUND");
    });
  });
});
