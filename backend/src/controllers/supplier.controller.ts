import type { Request, Response } from "express";
import { IntegrationError } from "../services/integration-errors.js";
import {
  supplierService,
  type CreateSupplierInput,
  type SupplierService,
} from "../services/supplier.service.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IntegrationError(400, "INVALID_SUPPLIER", `${name} is required`);
  }
  return value.trim();
}

function parseSupplierInput(value: unknown): CreateSupplierInput {
  if (!isObject(value)) {
    throw new IntegrationError(400, "INVALID_SUPPLIER", "A JSON object is required");
  }

  const name = requiredText(value.name, "name");
  const email = requiredText(value.email, "email");
  const country = requiredText(value.country, "country");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IntegrationError(400, "INVALID_SUPPLIER", "email must be a valid email address");
  }
  if (value.active !== undefined && typeof value.active !== "boolean") {
    throw new IntegrationError(400, "INVALID_SUPPLIER", "active must be a boolean");
  }

  return {
    name,
    email,
    country,
    active: value.active === undefined ? true : value.active,
  };
}

export function createSupplierController(service: SupplierService = supplierService) {
  return {
    async create(request: Request, response: Response): Promise<void> {
      const data = await service.create(parseSupplierInput(request.body));
      response.status(201).json({ success: true, data });
    },

    async list(_request: Request, response: Response): Promise<void> {
      response.json({ success: true, data: await service.list() });
    },

    async get(request: Request, response: Response): Promise<void> {
      const id = request.params.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new IntegrationError(400, "INVALID_PARAMETER", "A valid supplier ID is required");
      }
      const data = await service.get(id);
      if (!data) {
        throw new IntegrationError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found");
      }
      response.json({ success: true, data });
    },
  };
}
