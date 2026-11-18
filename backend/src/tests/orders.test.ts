import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import express from "express";
import {
  Prisma,
  type Order,
  type OrderItem,
  type Product,
  type RetailTraceSync,
  type Supplier,
} from "../generated/prisma/client.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createOrderRouter } from "../routes/order.routes.js";
import {
  IntegrationError,
  RetailTraceApiError,
} from "../services/integration-errors.js";
import {
  createOrderService,
  type CreateOrderInput,
  type OrderRepository,
  type OrderView,
} from "../services/order.service.js";

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
  const products: Product[] = [
    {
      id: "product-local-a",
      name: "Calendula Balm",
      price: new Prisma.Decimal("10.00"),
      stockQuantity: 20,
      organic: true,
      manufacturedOn: new Date("2026-09-10T00:00:00.000Z"),
      supplierId: supplier.id,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "product-local-b",
      name: "Rosehip Oil",
      price: new Prisma.Decimal("7.50"),
      stockQuantity: 15,
      organic: true,
      manufacturedOn: new Date("2026-09-12T00:00:00.000Z"),
      supplierId: supplier.id,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const productSynchronizations: RetailTraceSync[] = products.map((product, index) => ({
    id: `product-sync-${index + 1}`,
    entityType: "Product",
    localEntityId: product.id,
    retailTraceRecordId: `507f1f77bcf86cd79943901${index + 1}`,
    transactionId: null,
    syncStatus: "SYNCED",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  }));
  const orders: OrderView[] = [];
  let nextOrderId = 0;
  const repository: OrderRepository = {
    async createWithPendingSync(input) {
      const byId = new Map(products.map((product) => [product.id, product]));
      for (const item of input.items) {
        if (!byId.has(item.productId)) {
          throw new IntegrationError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product '${item.productId}' was not found`,
          );
        }
      }

      nextOrderId += 1;
      const total = input.items.reduce((sum, item) => {
        const product = byId.get(item.productId);
        assert.ok(product);
        return sum + product.price.toNumber() * item.quantity;
      }, 0);
      const order: Order = {
        id: `order-${nextOrderId}`,
        customerName: input.customerName,
        total: new Prisma.Decimal(total.toFixed(2)),
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      };
      const synchronization: RetailTraceSync = {
        id: `order-sync-${nextOrderId}`,
        entityType: "Order",
        localEntityId: order.id,
        retailTraceRecordId: null,
        transactionId: null,
        syncStatus: "PENDING",
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      const items = input.items
        .map((item, index) => {
          const product = byId.get(item.productId);
          assert.ok(product);
          const orderItem: OrderItem = {
            id: `order-item-${index + 1}`,
            orderId: order.id,
            productId: product.id,
            quantity: item.quantity,
            unitPrice: product.price,
          };
          return {
            orderItem,
            product,
            synchronization:
              productSynchronizations.find((sync) => sync.localEntityId === product.id) ?? null,
          };
        })
        .sort((left, right) => left.product.id.localeCompare(right.product.id));
      const view: OrderView = { order, items, synchronization };
      orders.push(view);
      return view;
    },
    async list() {
      return [...orders];
    },
    async get(id) {
      return orders.find(({ order }) => order.id === id) ?? null;
    },
  };
  return { repository, orders, productSynchronizations };
}

async function withOrderApi(
  service: ReturnType<typeof createOrderService>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", createOrderRouter(service));
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

const orderInput: CreateOrderInput = {
  customerName: "Morgan Lee",
  items: [
    { productId: "product-local-b", quantity: 1 },
    { productId: "product-local-a", quantity: 2 },
  ],
};

describe("Order API", () => {
  it("creates an Order with local OrderItems and synchronized Product references", async () => {
    const { repository, orders, productSynchronizations } = createInMemoryRepository();
    const service = createOrderService(repository, async (orderId) => {
      const view = await repository.get(orderId);
      assert.ok(view?.synchronization);
      assert.deepEqual(
        view.items.map((item) => item.synchronization?.retailTraceRecordId),
        ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
      );
      assert.notEqual(
        view.items[0]?.synchronization?.retailTraceRecordId,
        view.items[0]?.product.id,
      );
      view.synchronization.retailTraceRecordId = "507f1f77bcf86cd799439099";
      view.synchronization.syncStatus = "SYNCED";
      return view.synchronization;
    });

    await withOrderApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(orderInput),
      });
      const body = await readJson(response);
      const data = body.data as OrderView;

      assert.equal(response.status, 201);
      assert.equal(body.success, true);
      assert.equal(Number(data.order.total), 27.5);
      assert.equal(data.order.status, "PENDING");
      assert.equal(data.items.length, 2);
      assert.equal(data.synchronization?.syncStatus, "SYNCED");
      assert.equal(data.synchronization?.retailTraceRecordId, "507f1f77bcf86cd799439099");
      assert.equal(productSynchronizations.length, 2);
      assert.equal(orders.length, 1);
    });
  });

  it("rejects invalid items and references to nonexistent local Products", async () => {
    const { repository, orders } = createInMemoryRepository();
    const service = createOrderService(repository, async () => {
      throw new Error("Synchronization must not run for invalid input");
    });

    await withOrderApi(service, async (baseUrl) => {
      const invalidResponse = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...orderInput, items: [{ productId: "product-local-a", quantity: 0 }] }),
      });
      const invalidBody = await readJson(invalidResponse);
      const invalidError = invalidBody.error as Record<string, unknown>;
      assert.equal(invalidResponse.status, 400);
      assert.equal(invalidError.code, "INVALID_ORDER");
      assert.equal(orders.length, 0);

      const emptyItemsResponse = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerName: "Morgan Lee", items: [] }),
      });
      assert.equal(emptyItemsResponse.status, 400);
      assert.equal(orders.length, 0);

      const duplicateItemsResponse = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: "Morgan Lee",
          items: [
            { productId: "product-local-a", quantity: 1 },
            { productId: "product-local-a", quantity: 2 },
          ],
        }),
      });
      assert.equal(duplicateItemsResponse.status, 400);
      assert.equal(orders.length, 0);

      const missingResponse = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: "Morgan Lee",
          items: [{ productId: "missing-product", quantity: 1 }],
        }),
      });
      const missingBody = await readJson(missingResponse);
      const missingError = missingBody.error as Record<string, unknown>;
      assert.equal(missingResponse.status, 404);
      assert.equal(missingError.code, "PRODUCT_NOT_FOUND");
      assert.equal(orders.length, 0);
    });
  });

  it("preserves the local Order and failed sync mapping when RetailTrace is unavailable", async () => {
    const { repository, orders } = createInMemoryRepository();
    const service = createOrderService(repository, async (orderId) => {
      const view = await repository.get(orderId);
      const synchronization = view?.synchronization;
      assert.ok(synchronization);
      synchronization.syncStatus = "FAILED";
      synchronization.errorMessage =
        "RETAILTRACE_UNAVAILABLE: RetailTrace could not be reached";
      throw new RetailTraceApiError(
        503,
        "RETAILTRACE_UNAVAILABLE",
        "RetailTrace could not be reached",
        null,
      );
    });

    await withOrderApi(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(orderInput),
      });
      const body = await readJson(response);
      const data = body.data as OrderView;

      assert.equal(response.status, 201);
      assert.equal(orders.length, 1);
      assert.equal(data.order.id, "order-1");
      assert.equal(data.synchronization?.syncStatus, "FAILED");
      assert.equal(data.synchronization?.retailTraceRecordId, null);
    });
  });

  it("lists Orders and returns a not-found response for an unknown ID", async () => {
    const { repository } = createInMemoryRepository();
    const service = createOrderService(repository, async (orderId) => {
      const view = await repository.get(orderId);
      assert.ok(view?.synchronization);
      view.synchronization.syncStatus = "SYNCED";
      return view.synchronization;
    });
    await service.create(orderInput);

    await withOrderApi(service, async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/orders`);
      const listBody = await readJson(listResponse);
      const list = listBody.data as OrderView[];
      assert.equal(listResponse.status, 200);
      assert.equal(list.length, 1);
      assert.equal(list[0]?.items.length, 2);

      const getResponse = await fetch(`${baseUrl}/api/orders/order-1`);
      const getBody = await readJson(getResponse);
      const detail = getBody.data as OrderView;
      assert.equal(getResponse.status, 200);
      assert.equal(detail.order.id, "order-1");
      assert.equal(detail.items.length, 2);

      const notFoundResponse = await fetch(`${baseUrl}/api/orders/missing`);
      const notFoundBody = await readJson(notFoundResponse);
      const error = notFoundBody.error as Record<string, unknown>;
      assert.equal(notFoundResponse.status, 404);
      assert.equal(error.code, "ORDER_NOT_FOUND");
    });
  });
});
