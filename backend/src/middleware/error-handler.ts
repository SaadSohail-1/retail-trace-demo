import type { ErrorRequestHandler } from "express";
import { IntegrationError } from "../services/integration-errors.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof IntegrationError) {
    response.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    success: false,
    error: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" },
  });
};
