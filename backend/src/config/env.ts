import "dotenv/config";

const port = Number(process.env.PORT ?? 5001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const databaseUrlParsed = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(databaseUrlParsed.protocol)) {
  throw new Error("DATABASE_URL must use the PostgreSQL protocol");
}

const retailTraceBaseUrl = process.env.RETAILTRACE_BASE_URL;
if (!retailTraceBaseUrl) {
  throw new Error("RETAILTRACE_BASE_URL is required");
}

const retailTraceUrlParsed = new URL(retailTraceBaseUrl);
if (!["http:", "https:"].includes(retailTraceUrlParsed.protocol)) {
  throw new Error("RETAILTRACE_BASE_URL must use HTTP or HTTPS");
}

const retailTraceApiKey = process.env.RETAILTRACE_API_KEY;
if (!retailTraceApiKey) {
  throw new Error("RETAILTRACE_API_KEY is required");
}

export const env = {
  port,
  databaseUrl,
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  retailTraceBaseUrl: retailTraceBaseUrl.replace(/\/+$/, ""),
  retailTraceApiKey,
};
