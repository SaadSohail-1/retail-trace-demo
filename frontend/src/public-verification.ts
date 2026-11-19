export interface PublicVerificationResult {
  status: "VERIFIED" | "NOT_VERIFIED" | "PENDING" | "UNAVAILABLE";
  orderReference?: string;
  recordId?: string;
  publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
  transactionId?: string | null;
  publicationTimestamp?: string;
  network?: string;
  streamName?: string;
  commitmentHash?: string;
  confirmations?: number;
  blockHeight?: number;
  verificationTimestamp: string;
  checks: {
    transactionExists: boolean | null;
    recordFound: boolean | null;
    commitmentMatches: boolean | null;
  };
  independentVerificationUrl?: string;
  explanation: string;
}

function isOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || typeof value[key] === "string";
}

function isPublicVerificationResult(value: unknown): value is PublicVerificationResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    (value.status !== "VERIFIED" &&
      value.status !== "NOT_VERIFIED" &&
      value.status !== "PENDING" &&
      value.status !== "UNAVAILABLE") ||
    !("checks" in value) ||
    typeof value.checks !== "object" ||
    value.checks === null ||
    !("transactionExists" in value.checks) ||
    (value.checks.transactionExists !== null && typeof value.checks.transactionExists !== "boolean") ||
    !("recordFound" in value.checks) ||
    (value.checks.recordFound !== null && typeof value.checks.recordFound !== "boolean") ||
    !("commitmentMatches" in value.checks) ||
    (value.checks.commitmentMatches !== null && typeof value.checks.commitmentMatches !== "boolean") ||
    !("verificationTimestamp" in value) ||
    typeof value.verificationTimestamp !== "string" ||
    !("explanation" in value) ||
    typeof value.explanation !== "string" ||
    ("orderReference" in value && typeof value.orderReference !== "string") ||
    ("recordId" in value && typeof value.recordId !== "string") ||
    ("publicationStatus" in value &&
      value.publicationStatus !== null &&
      value.publicationStatus !== "PENDING" &&
      value.publicationStatus !== "CONFIRMED" &&
      value.publicationStatus !== "FAILED") ||
    ("transactionId" in value &&
      value.transactionId !== null &&
      typeof value.transactionId !== "string") ||
    !isOptionalString(value, "publicationTimestamp") ||
    !isOptionalString(value, "network") ||
    !isOptionalString(value, "streamName") ||
    !isOptionalString(value, "commitmentHash") ||
    ("confirmations" in value && typeof value.confirmations !== "number") ||
    ("blockHeight" in value && typeof value.blockHeight !== "number") ||
    !isOptionalString(value, "independentVerificationUrl")
  ) {
    return false;
  }
  return true;
}

export function parsePublicVerification(value: unknown): PublicVerificationResult {
  if (!isPublicVerificationResult(value)) {
    throw new Error("Verdant returned an invalid public verification response.");
  }
  return {
    status: value.status,
    ...(value.orderReference !== undefined
      ? { orderReference: value.orderReference }
      : {}),
    ...(value.recordId !== undefined ? { recordId: value.recordId } : {}),
    ...(value.publicationStatus !== undefined
      ? { publicationStatus: value.publicationStatus }
      : {}),
    ...(value.transactionId !== undefined
      ? { transactionId: value.transactionId }
      : {}),
    ...(value.publicationTimestamp !== undefined
      ? { publicationTimestamp: value.publicationTimestamp }
      : {}),
    ...(value.network !== undefined ? { network: value.network } : {}),
    ...(value.streamName !== undefined ? { streamName: value.streamName } : {}),
    ...(value.commitmentHash !== undefined
      ? { commitmentHash: value.commitmentHash }
      : {}),
    ...(value.confirmations !== undefined ? { confirmations: value.confirmations } : {}),
    ...(value.blockHeight !== undefined ? { blockHeight: value.blockHeight } : {}),
    verificationTimestamp: value.verificationTimestamp,
    checks: {
      transactionExists: value.checks.transactionExists,
      recordFound: value.checks.recordFound,
      commitmentMatches: value.checks.commitmentMatches,
    },
    ...(value.independentVerificationUrl !== undefined
      ? { independentVerificationUrl: value.independentVerificationUrl }
      : {}),
    explanation: value.explanation,
  };
}

export function publicVerificationTitle(status: PublicVerificationResult["status"]): string {
  switch (status) {
    case "VERIFIED":
      return "Blockchain record verified";
    case "PENDING":
      return "Blockchain publication is pending";
    case "UNAVAILABLE":
      return "Verification temporarily unavailable";
    case "NOT_VERIFIED":
      return "We could not verify this order";
  }
}
