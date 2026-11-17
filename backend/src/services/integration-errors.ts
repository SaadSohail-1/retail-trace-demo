export class IntegrationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export class RetailTraceApiError extends IntegrationError {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    readonly upstreamStatus: number | null,
  ) {
    super(statusCode, code, message);
    this.name = "RetailTraceApiError";
  }
}
