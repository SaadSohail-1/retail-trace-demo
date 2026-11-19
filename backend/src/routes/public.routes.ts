import { Router } from "express";
import {
  createPublicOrderController,
  createPublicRecordController,
  createPublicVerificationController,
} from "../controllers/public-verification.controller.js";
import { createPublicVerificationRateLimit } from "../middleware/public-verification-rate-limit.js";
import {
  getPublicOrder,
  getPublicRetailTraceRecord,
  verifyPublicRecord,
} from "../services/public-verification.service.js";

export function createPublicRouter(
  verify = verifyPublicRecord,
  rateLimit = createPublicVerificationRateLimit(),
  lookupOrder = getPublicOrder,
  lookupRecord = getPublicRetailTraceRecord,
) {
  const router = Router();

  router.use(rateLimit);
  router.get("/order/:recordId", createPublicOrderController(lookupOrder));
  router.get("/record/:recordId", createPublicRecordController(lookupRecord));
  router.get("/verify/:recordId", createPublicVerificationController(verify));
  return router;
}

export const publicRouter = createPublicRouter();
