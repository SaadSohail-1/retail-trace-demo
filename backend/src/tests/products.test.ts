import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import express from "express";
import {
  Prisma,
  type Product,
  type RetailTraceSync,
  type Supplier,
} from "../generated/prisma/client.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createProductRouter } from "../routes/product.routes.js";
import {
  IntegrationError,
  RetailTraceApiError,
} from "../services/integration-errors.js";
import {
  createProductService,
  type ProductRepository,
  type ProductView,
} from "../services/product.service.js";

function createInMemoryRepository() {
  const now = new Date();
  const supplier: Supplier = {
    id: "supplier-local-1",
    name: "Green Valley Botanicals",
    email: "hello@greenvalley.example",
    country: "Canada",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const supplierSynchronization: RetailTraceSync = {
    id: "supplier-sync-1",
    entityType: "Supplier",
    localEntityId: supplier.id,
    retailTraceRecordId: "507f1f77bcf86cd799439011",
    transactionId: null,
    syncStatus: "SYNCED",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  const entries: ProductView[] = [];
  let nextId = 0;
  const repository: ProductRepository = {
    async createWithPendingSync(input) {
      if (input.supplierId !== supplier.id) {
        throw new IntegrationError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found");
      }
      nextId += 1;
      const product: Product = {
        id: `product-${nextId}`,
        name: input.name,
        price: new Prisma.Decimal(input.price),
        stockQuantity: input.stockQuantity,
        organic: input.organic,
        manufacturedOn: input.manufacturedOn,
        supplierId: input.supplierId,
        createdAt: now,
        updatedAt: now,
      };
      const synchronization: RetailTraceSync = {
        id: `product-sync-${nextId}`,
        entityType: "Product",
        localEntityId: product.id,
        retailTraceRecordId: null,
        transactionId: null,
        syncStatus: "PENDING",
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      const view = { product, supplier, synchronization };
      entries.push(view);
      return view;
    },
    async list() {
      return [...entries];
    },
    async get(id) {
      return entries.find(({ product }) => product.id === id) ?? null;
    },
  };
  return { repository, entries, supplier, supplierSynchronization };
}

async function withProductApi(
  service: ReturnType<typeof createProductService>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/products", createProductRouter(service));
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

const productInput = {
  name: "Organic Calendula Balm",
  price: 18.5,
  stockQuantity: 32,
  organic: true,
  manufacturedOn: "2026-09-10",
  supplierId: "supplier-local-1",
};

describe("Product API", () => {
  it("creates a Product using the Supplier's RetailTrace record ID", async () => {
    const { repository, entries, supplierSynchronization } = createInMemoryRepository();
    let resolvedSupplierReference: string | null = null;
    const service = createProductService(repository, async (productId) => {
      const entry = entries.find(({ product }) => product.id === productId);
      assert.ok(entry);
      const synchronization = entry.synchronization;
      assert.ok(synchronization);
      assert.equal(entry.product.supplierId, "supplier-local-1");
      resolvedSupplierReference = supplierSynchronization.retailTraceRecordId;
      assert.notEqual(resolvedSupplierReference, entry.product.supplierId);
      synchronization.retailTraceRecordId = "507f1f77bcf86cd799439012";
      synchronization.syncStatus = "SYNCED";
      return synchronization;
    });

    await withProductApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productInput),
      });
      const body = await readJson(response);
      const data = body.data as ProductView;

      assert.equal(response.status, 201);
      assert.equal(body.success, true);
      assert.equal(data.product.supplierId, "supplier-local-1");
      assert.equal(data.product.organic, true);
      assert.equal(data.synchronization?.syncStatus, "SYNCED");
      assert.equal(data.synchronization?.retailTraceRecordId, "507f1f77bcf86cd799439012");
      assert.equal(resolvedSupplierReference, "507f1f77bcf86cd799439011");
    });
  });

  it("rejects malformed product fields and nonexistent local Suppliers", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createProductService(repository, async () => {
      throw new Error("Synchronization must not run for invalid input");
    });

    await withProductApi(service, async (baseUrl) => {
      const invalidResponse = await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...productInput, stockQuantity: 1.5 }),
      });
      const invalidBody = await readJson(invalidResponse);
      const invalidError = invalidBody.error as Record<string, unknown>;
      assert.equal(invalidResponse.status, 400);
      assert.equal(invalidError.code, "INVALID_PRODUCT");
      assert.equal(entries.length, 0);

      const missingSupplierResponse = await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...productInput, supplierId: "missing-local-supplier" }),
      });
      const missingSupplierBody = await readJson(missingSupplierResponse);
      const missingSupplierError = missingSupplierBody.error as Record<string, unknown>;
      assert.equal(missingSupplierResponse.status, 404);
      assert.equal(missingSupplierError.code, "SUPPLIER_NOT_FOUND");
      assert.equal(entries.length, 0);
    });
  });

  it("preserves a local Product and failed sync state when RetailTrace is unavailable", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createProductService(repository, async (productId) => {
      const entry = entries.find(({ product }) => product.id === productId);
      const synchronization = entry?.synchronization;
      assert.ok(synchronization);
      synchronization.syncStatus = "FAILED";
      synchronization.errorMessage = "RETAILTRACE_UNAVAILABLE: RetailTrace could not be reached";
      throw new RetailTraceApiError(
        503,
        "RETAILTRACE_UNAVAILABLE",
        "RetailTrace could not be reached",
        null,
      );
    });

    await withProductApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productInput),
      });
      const body = await readJson(response);
      const data = body.data as ProductView;

      assert.equal(response.status, 201);
      assert.equal(entries.length, 1);
      assert.equal(data.product.id, "product-1");
      assert.equal(data.synchronization?.syncStatus, "FAILED");
      assert.equal(data.synchronization?.retailTraceRecordId, null);
    });
  });

  it("lists Products and returns a not-found response for an unknown ID", async () => {
    const { repository, entries } = createInMemoryRepository();
    const service = createProductService(repository, async (productId) => {
      const entry = await repository.get(productId);
      const synchronization = entry?.synchronization;
      assert.ok(synchronization);
      synchronization.syncStatus = "SYNCED";
      return synchronization;
    });
    await service.create({
      ...productInput,
      manufacturedOn: new Date("2026-09-10T00:00:00.000Z"),
    });

    await withProductApi(service, async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/products`);
      const listBody = await readJson(listResponse);
      const list = listBody.data as ProductView[];
      assert.equal(listResponse.status, 200);
      assert.equal(list.length, 1);
      assert.equal(list[0]?.product.id, "product-1");

      const getResponse = await fetch(`${baseUrl}/api/products/product-1`);
      const getBody = await readJson(getResponse);
      const detail = getBody.data as ProductView;
      assert.equal(getResponse.status, 200);
      assert.equal(detail.product.id, "product-1");

      const notFoundResponse = await fetch(`${baseUrl}/api/products/missing`);
      const notFoundBody = await readJson(notFoundResponse);
      const error = notFoundBody.error as Record<string, unknown>;
      assert.equal(notFoundResponse.status, 404);
      assert.equal(error.code, "PRODUCT_NOT_FOUND");
    });
  });
});
