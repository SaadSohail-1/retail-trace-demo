import type { NextFunction, Request, Response } from "express";

interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
}

interface ClientWindow {
  count: number;
  resetAt: number;
}

export function createPublicVerificationRateLimit(options: RateLimitOptions = {}) {
  const maxRequests = options.maxRequests ?? 30;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const clients = new Map<string, ClientWindow>();
  let requestsSinceCleanup = 0;

  return function publicVerificationRateLimit(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const timestamp = now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    let window = clients.get(key);

    if (!window || window.resetAt <= timestamp) {
      window = { count: 0, resetAt: timestamp + windowMs };
      clients.set(key, window);
    }

    if (window.count >= maxRequests) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.resetAt - timestamp) / 1000))));
      response.status(429).json({
        success: false,
        error: {
          code: "PUBLIC_VERIFICATION_RATE_LIMITED",
          message: "Too many verification requests. Please try again shortly.",
        },
      });
      return;
    }

    window.count += 1;
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 256 || clients.size > 10_000) {
      for (const [clientKey, clientWindow] of clients) {
        if (clientWindow.resetAt <= timestamp) {
          clients.delete(clientKey);
        }
      }
      if (clients.size > 10_000) {
        const keys = clients.keys();
        while (clients.size > 9_000) {
          const oldest = keys.next().value;
          if (oldest === undefined) break;
          clients.delete(oldest);
        }
      }
      requestsSinceCleanup = 0;
    }

    next();
  };
}
