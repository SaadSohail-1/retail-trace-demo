import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";
import { integrationRouter } from "./routes/integration.routes.js";
import { orderRouter } from "./routes/order.routes.js";
import { productRouter } from "./routes/product.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { supplierRouter } from "./routes/supplier.routes.js";

export const app = express();

app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = new Set([
        env.frontendOrigin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]);
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  }),
);
app.use(express.json());
app.use("/api/health", healthRouter);
app.use("/api/public", publicRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/products", productRouter);
app.use("/api/orders", orderRouter);
app.use("/api/integration", integrationRouter);
app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});
app.use(errorHandler);
