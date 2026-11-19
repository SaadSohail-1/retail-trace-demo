import { Router } from "express";
import { createOrderController } from "../controllers/order.controller.js";
import type { OrderService } from "../services/order.service.js";

export function createOrderRouter(service?: OrderService, publicAppUrl?: string | null) {
  const router = Router();
  const controller = createOrderController(service, publicAppUrl);

  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:id", controller.get);

  return router;
}

export const orderRouter = createOrderRouter();
