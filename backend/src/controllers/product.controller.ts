import type { Request, Response } from "express";
import { IntegrationError } from "../services/integration-errors.js";
import {
  productService,
  type CreateProductInput,
  type ProductService,
} from "../services/product.service.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IntegrationError(400, "INVALID_PRODUCT", `${name} is required`);
  }
  return value.trim();
}

function parseManufacturedOn(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new IntegrationError(
      400,
      "INVALID_PRODUCT",
      "manufacturedOn must be a valid YYYY-MM-DD date",
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new IntegrationError(
      400,
      "INVALID_PRODUCT",
      "manufacturedOn must be a valid YYYY-MM-DD date",
    );
  }
  return date;
}

function parseProductInput(value: unknown): CreateProductInput {
  if (!isObject(value)) {
    throw new IntegrationError(400, "INVALID_PRODUCT", "A JSON object is required");
  }

  const name = requiredText(value.name, "name");
  const supplierId = requiredText(value.supplierId, "supplierId");
  if (
    typeof value.price !== "number" ||
    !Number.isFinite(value.price) ||
    value.price <= 0 ||
    value.price >= 100_000_000 ||
    Math.round(value.price * 100) / 100 !== value.price
  ) {
    throw new IntegrationError(
      400,
      "INVALID_PRODUCT",
      "price must be positive, below 100000000, and have no more than two decimal places",
    );
  }
  if (
    typeof value.stockQuantity !== "number" ||
    !Number.isInteger(value.stockQuantity) ||
    value.stockQuantity < 0 ||
    value.stockQuantity > 2_147_483_647
  ) {
    throw new IntegrationError(
      400,
      "INVALID_PRODUCT",
      "stockQuantity must be a non-negative 32-bit integer",
    );
  }
  if (value.organic !== undefined && typeof value.organic !== "boolean") {
    throw new IntegrationError(400, "INVALID_PRODUCT", "organic must be a boolean");
  }

  return {
    name,
    price: value.price,
    stockQuantity: value.stockQuantity,
    organic: value.organic === undefined ? false : value.organic,
    manufacturedOn: parseManufacturedOn(value.manufacturedOn),
    supplierId,
  };
}

export function createProductController(service: ProductService = productService) {
  return {
    async create(request: Request, response: Response): Promise<void> {
      const data = await service.create(parseProductInput(request.body));
      response.status(201).json({ success: true, data });
    },

    async list(_request: Request, response: Response): Promise<void> {
      response.json({ success: true, data: await service.list() });
    },

    async get(request: Request, response: Response): Promise<void> {
      const id = request.params.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new IntegrationError(400, "INVALID_PARAMETER", "A valid product ID is required");
      }
      const data = await service.get(id);
      if (!data) {
        throw new IntegrationError(404, "PRODUCT_NOT_FOUND", "Product was not found");
      }
      response.json({ success: true, data });
    },
  };
}
