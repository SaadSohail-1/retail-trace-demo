import type { Request, Response } from "express";
import { verifyPublicRecord } from "../services/public-verification.service.js";

export function createPublicVerificationController(
  verify: typeof verifyPublicRecord = verifyPublicRecord,
) {
  return async function publicVerificationController(
    request: Request,
    response: Response,
  ): Promise<void> {
    const recordId = typeof request.params.recordId === "string"
      ? request.params.recordId
      : "";
    response.json({
      success: true,
      data: await verify(recordId),
    });
  };
}

export const publicVerificationController = createPublicVerificationController();
