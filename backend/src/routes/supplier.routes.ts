import { Router } from "express";
import {
  createSupplierController,
} from "../controllers/supplier.controller.js";
import type { SupplierService } from "../services/supplier.service.js";

export function createSupplierRouter(service?: SupplierService) {
  const router = Router();
  const controller = createSupplierController(service);

  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:id", controller.get);

  return router;
}

export const supplierRouter = createSupplierRouter();
