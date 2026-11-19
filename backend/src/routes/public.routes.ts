import { Router } from "express";
import { createPublicVerificationController } from "../controllers/public-verification.controller.js";
import { createPublicVerificationRateLimit } from "../middleware/public-verification-rate-limit.js";
import { verifyPublicRecord } from "../services/public-verification.service.js";

export function createPublicRouter(
  verify = verifyPublicRecord,
  rateLimit = createPublicVerificationRateLimit(),
) {
  const router = Router();

  router.get(
    "/verify/:recordId",
    rateLimit,
    createPublicVerificationController(verify),
  );
  return router;
}

export const publicRouter = createPublicRouter();
