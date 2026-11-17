import { prisma } from "../config/database.js";
import type {
  Order,
  OrderItem,
  Product,
  RetailTraceSync,
} from "../generated/prisma/client.js";
import { IntegrationError } from "./integration-errors.js";
import { syncOrder } from "./sync.service.js";

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerName: string;
  items: CreateOrderItemInput[];
}

export interface OrderItemView {
  orderItem: OrderItem;
  product: Product;
  synchronization: RetailTraceSync | null;
}

export interface OrderView {
  order: Order;
  items: OrderItemView[];
  synchronization: RetailTraceSync | null;
}

export interface OrderRepository {
  createWithPendingSync(input: CreateOrderInput): Promise<OrderView>;
  list(): Promise<OrderView[]>;
  get(id: string): Promise<OrderView | null>;
}

export interface OrderService {
  create(input: CreateOrderInput): Promise<OrderView>;
  list(): Promise<OrderView[]>;
  get(id: string): Promise<OrderView | null>;
}

type OrderRow = Order & {
  items: Array<OrderItem & { product: Product }>;
};

function syncKey(entityType: string, localEntityId: string): string {
  return `${entityType}:${localEntityId}`;
}

function toOrderView(
  row: OrderRow,
  synchronizations: Map<string, RetailTraceSync>,
): OrderView {
  const { items, ...order } = row;
  return {
    order,
    items: items.map(({ product, ...orderItem }) => ({
      orderItem,
      product,
      synchronization: synchronizations.get(syncKey("Product", product.id)) ?? null,
    })),
    synchronization: synchronizations.get(syncKey("Order", order.id)) ?? null,
  };
}

async function loadOrders(rows: OrderRow[]): Promise<OrderView[]> {
  if (rows.length === 0) {
    return [];
  }
  const localIds = [
    ...rows.map(({ id }) => id),
    ...rows.flatMap(({ items }) => items.map(({ product }) => product.id)),
  ];
  const synchronizations = await prisma.retailTraceSync.findMany({
    where: {
      entityType: { in: ["Order", "Product"] },
      localEntityId: { in: localIds },
    },
  });
  const byEntityAndId = new Map(
    synchronizations.map((synchronization) => [
      syncKey(synchronization.entityType, synchronization.localEntityId),
      synchronization,
    ]),
  );
  return rows.map((row) => toOrderView(row, byEntityAndId));
}

const orderRepository: OrderRepository = {
  async createWithPendingSync(input) {
    const distinctProductIds = new Set(input.items.map(({ productId }) => productId));
    if (distinctProductIds.size !== input.items.length) {
      throw new IntegrationError(
        400,
        "DUPLICATE_ORDER_PRODUCT",
        "An Order can contain only one item row per Product",
      );
    }

    return prisma.$transaction(async (transaction) => {
      const products = await transaction.product.findMany({
        where: { id: { in: input.items.map(({ productId }) => productId) } },
      });
      const productsById = new Map(products.map((product) => [product.id, product]));
      for (const item of input.items) {
        if (!productsById.has(item.productId)) {
          throw new IntegrationError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product '${item.productId}' was not found`,
          );
        }
      }

      const totalCents = input.items.reduce((total, item) => {
        const product = productsById.get(item.productId);
        if (!product) {
          throw new IntegrationError(
            404,
            "PRODUCT_NOT_FOUND",
            `Product '${item.productId}' was not found`,
          );
        }
        return total + Math.round(product.price.toNumber() * 100) * item.quantity;
      }, 0);
      if (!Number.isSafeInteger(totalCents) || totalCents > 9_999_999_999) {
        throw new IntegrationError(
          422,
          "ORDER_TOTAL_OUT_OF_RANGE",
          "The calculated order total exceeds the supported range",
        );
      }

      const created = await transaction.order.create({
        data: {
          customerName: input.customerName,
          total: (totalCents / 100).toFixed(2),
          status: "PENDING",
          items: {
            create: input.items.map((item) => {
              const product = productsById.get(item.productId);
              if (!product) {
                throw new IntegrationError(
                  404,
                  "PRODUCT_NOT_FOUND",
                  `Product '${item.productId}' was not found`,
                );
              }
              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: product.price.toString(),
              };
            }),
          },
        },
        include: {
          items: {
            include: { product: true },
            orderBy: { productId: "asc" },
          },
        },
      });
      const synchronization = await transaction.retailTraceSync.create({
        data: {
          entityType: "Order",
          localEntityId: created.id,
          syncStatus: "PENDING",
        },
      });
      const { items, ...order } = created;
      return {
        order,
        items: items.map(({ product, ...orderItem }) => ({
          orderItem,
          product,
          synchronization: null,
        })),
        synchronization,
      };
    });
  },

  async list() {
    const rows = await prisma.order.findMany({
      include: {
        items: {
          include: { product: true },
          orderBy: { productId: "asc" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return loadOrders(rows);
  },

  async get(id) {
    const row = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: true },
          orderBy: { productId: "asc" },
        },
      },
    });
    if (!row) {
      return null;
    }
    const [order] = await loadOrders([row]);
    return order ?? null;
  },
};

export function createOrderService(
  repository: OrderRepository = orderRepository,
  synchronize: (orderId: string) => Promise<RetailTraceSync> = syncOrder,
): OrderService {
  return {
    async create(input) {
      const created = await repository.createWithPendingSync(input);
      try {
        await synchronize(created.order.id);
      } catch (error) {
        if (!(error instanceof IntegrationError)) {
          throw error;
        }
      }
      const result = await repository.get(created.order.id);
      if (!result) {
        throw new Error("Created Order could not be reloaded");
      }
      return result;
    },
    list: () => repository.list(),
    get: (id) => repository.get(id),
  };
}

export const orderService = createOrderService();
