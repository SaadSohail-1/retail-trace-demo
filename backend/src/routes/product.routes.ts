import { Router } from "express";
import { createProductController } from "../controllers/product.controller.js";
import type { ProductService } from "../services/product.service.js";

export function createProductRouter(service?: ProductService) {
  const router = Router();
  const controller = createProductController(service);

  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:id", controller.get);

  return router;
}

export const productRouter = createProductRouter();
