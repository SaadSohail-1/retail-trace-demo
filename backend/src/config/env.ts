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

function getPublicHttpsOrigin(
  value: string | undefined,
  variableName: string,
): string | null {
  if (!value) {
    return null;
  }

  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const mappedIpv4 = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ipv4 = (mappedIpv4?.[1] ?? hostname).split(".").map(Number);
  const isPrivateIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 0 ||
      ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 100 && ipv4[1]! >= 64 && ipv4[1]! <= 127));
  const isPrivateIpv6 =
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    /^fe[89ab]/.test(hostname);

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    isPrivateIpv4 ||
    isPrivateIpv6
  ) {
    throw new Error(`${variableName} must be an HTTPS public origin, not a local or private address`);
  }

  return parsed.origin;
}

export function getPublicAppUrl(value: string | undefined): string | null {
  return getPublicHttpsOrigin(value, "PUBLIC_APP_URL");
}

export function getPublicRetailTraceUrl(value: string | undefined): string | null {
  return getPublicHttpsOrigin(value, "PUBLIC_RETAILTRACE_URL");
}

export const env = {
  port,
  databaseUrl,
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  publicAppUrl: getPublicAppUrl(process.env.PUBLIC_APP_URL),
  publicRetailTraceUrl: getPublicRetailTraceUrl(process.env.PUBLIC_RETAILTRACE_URL),
  retailTraceBaseUrl: retailTraceBaseUrl.replace(/\/+$/, ""),
  retailTraceApiKey,
};
