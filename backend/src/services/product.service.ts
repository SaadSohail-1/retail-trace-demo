import { prisma } from "../config/database.js";
import type {
  Product,
  RetailTraceSync,
  Supplier,
} from "../generated/prisma/client.js";
import { IntegrationError } from "./integration-errors.js";
import { syncProduct } from "./sync.service.js";

export interface CreateProductInput {
  name: string;
  price: number;
  stockQuantity: number;
  organic: boolean;
  manufacturedOn: Date;
  supplierId: string;
}

export interface ProductView {
  product: Product;
  supplier: Supplier;
  synchronization: RetailTraceSync | null;
}

export interface ProductRepository {
  createWithPendingSync(input: CreateProductInput): Promise<ProductView>;
  list(): Promise<ProductView[]>;
  get(id: string): Promise<ProductView | null>;
}

export interface ProductService {
  create(input: CreateProductInput): Promise<ProductView>;
  list(): Promise<ProductView[]>;
  get(id: string): Promise<ProductView | null>;
}

const productRepository: ProductRepository = {
  async createWithPendingSync(input) {
    return prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({
        where: { id: input.supplierId },
      });
      if (!supplier) {
        throw new IntegrationError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found");
      }

      const product = await transaction.product.create({
        data: {
          ...input,
          price: input.price.toFixed(2),
        },
      });
      const synchronization = await transaction.retailTraceSync.create({
        data: {
          entityType: "Product",
          localEntityId: product.id,
          syncStatus: "PENDING",
        },
      });
      return { product, supplier, synchronization };
    });
  },

  async list() {
    const products = await prisma.product.findMany({
      include: { supplier: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const synchronizations = await prisma.retailTraceSync.findMany({
      where: {
        entityType: "Product",
        localEntityId: { in: products.map(({ id }) => id) },
      },
    });
    const byLocalId = new Map(
      synchronizations.map((synchronization) => [
        synchronization.localEntityId,
        synchronization,
      ]),
    );
    return products.map(({ supplier, ...product }) => ({
      product,
      supplier,
      synchronization: byLocalId.get(product.id) ?? null,
    }));
  },

  async get(id) {
    const result = await prisma.product.findUnique({
      where: { id },
      include: { supplier: true },
    });
    if (!result) {
      return null;
    }
    const synchronization = await prisma.retailTraceSync.findUnique({
      where: {
        entityType_localEntityId: { entityType: "Product", localEntityId: id },
      },
    });
    const { supplier, ...product } = result;
    return { product, supplier, synchronization };
  },
};

export function createProductService(
  repository: ProductRepository = productRepository,
  synchronize: (productId: string) => Promise<RetailTraceSync> = syncProduct,
): ProductService {
  return {
    async create(input) {
      const created = await repository.createWithPendingSync(input);
      try {
        await synchronize(created.product.id);
      } catch (error) {
        if (!(error instanceof IntegrationError)) {
          throw error;
        }
      }
      const result = await repository.get(created.product.id);
      if (!result) {
        throw new Error("Created Product could not be reloaded");
      }
      return result;
    },
    list: () => repository.list(),
    get: (id) => repository.get(id),
  };
}

export const productService = createProductService();
