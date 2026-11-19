import type { Request, Response } from "express";
import {
  getPublicOrder,
  getPublicRetailTraceRecord,
  verifyPublicRecord,
} from "../services/public-verification.service.js";

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
    try {
      response.json({
        success: true,
        data: await verify(recordId),
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "PUBLIC_VERIFICATION_UNAVAILABLE",
          message: "Verification is temporarily unavailable. Please try again later.",
        },
      });
    }
  };
}

export function createPublicOrderController(
  lookupOrder: typeof getPublicOrder = getPublicOrder,
) {
  return async function publicOrderController(
    request: Request,
    response: Response,
  ): Promise<void> {
    const recordId = typeof request.params.recordId === "string"
      ? request.params.recordId
      : "";
    try {
      response.json({
        success: true,
        data: await lookupOrder(recordId),
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "PUBLIC_ORDER_UNAVAILABLE",
          message: "Order information is temporarily unavailable. Please try again later.",
        },
      });
    }
  };
}

export function createPublicRecordController(
  lookupRecord: typeof getPublicRetailTraceRecord = getPublicRetailTraceRecord,
) {
  return async function publicRecordController(
    request: Request,
    response: Response,
  ): Promise<void> {
    const recordId = typeof request.params.recordId === "string"
      ? request.params.recordId
      : "";
    try {
      response.json({
        success: true,
        data: await lookupRecord(recordId),
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "PUBLIC_RECORD_UNAVAILABLE",
          message: "RetailTrace is temporarily unavailable. Please try again later.",
        },
      });
    }
  };
}

export const publicVerificationController = createPublicVerificationController();
