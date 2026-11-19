import { Router } from "express";
import {
  getHealth,
  getRecords,
  getSchemas,
  getStatus,
  getSchema,
  uploadSchema,
  compareSchema,
  initialize,
  retrySync,
  syncAll,
  verifyRecord,
  verifyTransaction,
} from "../controllers/integration.controller.js";

export const integrationRouter = Router();

integrationRouter.get("/status", getStatus);
integrationRouter.get("/health", getHealth);
integrationRouter.post("/initialize", initialize);
integrationRouter.post("/sync-all", syncAll);
integrationRouter.get("/schemas", getSchemas);
integrationRouter.post("/schemas", uploadSchema);
integrationRouter.get("/schemas/:schemaId", getSchema);
integrationRouter.get("/schemas/:schemaId/compare/:entity", compareSchema);
integrationRouter.get("/records", getRecords);
integrationRouter.post("/retry/:syncId", retrySync);
integrationRouter.get("/transactions/:transactionId/verify", verifyTransaction);
integrationRouter.get("/records/:recordId/verify", verifyRecord);
