import type { Request, Response } from "express";
import { IntegrationError } from "../services/integration-errors.js";
import {
  orderService,
  type CreateOrderInput,
  type CreateOrderItemInput,
  type OrderService,
} from "../services/order.service.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IntegrationError(400, "INVALID_ORDER", `${name} is required`);
  }
  return value.trim();
}

function parseItems(value: unknown): CreateOrderItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IntegrationError(
      400,
      "INVALID_ORDER",
      "items must contain at least one OrderItem",
    );
  }

  const items = value.map((item, index) => {
    if (!isObject(item)) {
      throw new IntegrationError(
        400,
        "INVALID_ORDER",
        `items[${index}] must be an object`,
      );
    }
    const productId = requiredText(item.productId, `items[${index}].productId`);
    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 2_147_483_647
    ) {
      throw new IntegrationError(
        400,
        "INVALID_ORDER",
        `items[${index}].quantity must be a positive 32-bit integer`,
      );
    }
    return { productId, quantity: item.quantity };
  });

  if (new Set(items.map(({ productId }) => productId)).size !== items.length) {
    throw new IntegrationError(
      400,
      "INVALID_ORDER",
      "An Order can contain only one item row per Product",
    );
  }
  return items;
}

function parseOrderInput(value: unknown): CreateOrderInput {
  if (!isObject(value)) {
    throw new IntegrationError(400, "INVALID_ORDER", "A JSON object is required");
  }
  return {
    customerName: requiredText(value.customerName, "customerName"),
    items: parseItems(value.items),
  };
}

export function createOrderController(service: OrderService = orderService) {
  return {
    async create(request: Request, response: Response): Promise<void> {
      const data = await service.create(parseOrderInput(request.body));
      response.status(201).json({ success: true, data });
    },

    async list(_request: Request, response: Response): Promise<void> {
      response.json({ success: true, data: await service.list() });
    },

    async get(request: Request, response: Response): Promise<void> {
      const id = request.params.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new IntegrationError(400, "INVALID_PARAMETER", "A valid order ID is required");
      }
      const data = await service.get(id);
      if (!data) {
        throw new IntegrationError(404, "ORDER_NOT_FOUND", "Order was not found");
      }
      response.json({ success: true, data });
    },
  };
}
