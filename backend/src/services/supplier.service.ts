import { prisma } from "../config/database.js";
import type { Supplier, RetailTraceSync } from "../generated/prisma/client.js";
import { IntegrationError } from "./integration-errors.js";
import { syncSupplier } from "./sync.service.js";

export interface CreateSupplierInput {
  name: string;
  email: string;
  country: string;
  active: boolean;
}

export interface SupplierView {
  supplier: Supplier;
  synchronization: RetailTraceSync | null;
}

export interface SupplierRepository {
  createWithPendingSync(input: CreateSupplierInput): Promise<SupplierView>;
  list(): Promise<SupplierView[]>;
  get(id: string): Promise<SupplierView | null>;
}

export interface SupplierService {
  create(input: CreateSupplierInput): Promise<SupplierView>;
  list(): Promise<SupplierView[]>;
  get(id: string): Promise<SupplierView | null>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

const supplierRepository: SupplierRepository = {
  async createWithPendingSync(input) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const supplier = await transaction.supplier.create({ data: input });
        const synchronization = await transaction.retailTraceSync.create({
          data: {
            entityType: "Supplier",
            localEntityId: supplier.id,
            syncStatus: "PENDING",
          },
        });
        return { supplier, synchronization };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new IntegrationError(
          409,
          "SUPPLIER_EMAIL_EXISTS",
          "A supplier with this email already exists",
        );
      }
      throw error;
    }
  },

  async list() {
    const suppliers = await prisma.supplier.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const synchronizations = await prisma.retailTraceSync.findMany({
      where: {
        entityType: "Supplier",
        localEntityId: { in: suppliers.map(({ id }) => id) },
      },
    });
    const byLocalId = new Map(
      synchronizations.map((synchronization) => [
        synchronization.localEntityId,
        synchronization,
      ]),
    );
    return suppliers.map((supplier) => ({
      supplier,
      synchronization: byLocalId.get(supplier.id) ?? null,
    }));
  },

  async get(id) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      return null;
    }
    const synchronization = await prisma.retailTraceSync.findUnique({
      where: {
        entityType_localEntityId: { entityType: "Supplier", localEntityId: id },
      },
    });
    return { supplier, synchronization };
  },
};

export function createSupplierService(
  repository: SupplierRepository = supplierRepository,
  synchronize: (supplierId: string) => Promise<RetailTraceSync> = syncSupplier,
): SupplierService {
  return {
    async create(input) {
      const created = await repository.createWithPendingSync(input);
      try {
        await synchronize(created.supplier.id);
      } catch (error) {
        if (!(error instanceof IntegrationError)) {
          throw error;
        }
      }
      const result = await repository.get(created.supplier.id);
      if (!result) {
        throw new Error("Created Supplier could not be reloaded");
      }
      return result;
    },
    list: () => repository.list(),
    get: (id) => repository.get(id),
  };
}

export const supplierService = createSupplierService();
