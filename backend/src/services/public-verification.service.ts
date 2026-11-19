import { prisma } from "../config/database.js";
import type { RetailTraceSync } from "../generated/prisma/client.js";
import { RetailTraceApiError } from "./integration-errors.js";
import { retailTraceApi } from "./retailtrace-api.service.js";

export type PublicVerificationStatus =
  | "VERIFIED"
  | "NOT_VERIFIED"
  | "PENDING"
  | "UNAVAILABLE";

export interface PublicVerificationResult {
  status: PublicVerificationStatus;
  orderReference?: string;
  publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
  transactionId?: string | null;
}

export interface PublicVerificationRepository {
  findOrderSyncByRecordId(recordId: string): Promise<RetailTraceSync | null>;
}

export interface PublicVerificationClient {
  verifyRecord(recordId: string): ReturnType<typeof retailTraceApi.verifyRecord>;
}

const prismaRepository: PublicVerificationRepository = {
  findOrderSyncByRecordId: (recordId) =>
    prisma.retailTraceSync.findFirst({
      where: {
        entityType: "Order",
        retailTraceRecordId: recordId,
      },
    }),
};

function isValidRetailTraceRecordId(recordId: string): boolean {
  return /^[a-f\d]{24}$/i.test(recordId);
}

function publicOrderReference(recordId: string): string {
  return `ORD-${recordId.slice(-8).toUpperCase()}`;
}

function detailsFor(
  sync: RetailTraceSync,
): Pick<PublicVerificationResult, "orderReference" | "publicationStatus" | "transactionId"> {
  const publicationStatus =
    sync.retailTraceStatus === "PENDING" ||
    sync.retailTraceStatus === "CONFIRMED" ||
    sync.retailTraceStatus === "FAILED"
      ? sync.retailTraceStatus
      : null;
  return {
    orderReference: publicOrderReference(sync.retailTraceRecordId ?? ""),
    publicationStatus,
    transactionId: sync.transactionId,
  };
}

export function createPublicVerificationService(
  repository: PublicVerificationRepository = prismaRepository,
  verificationClient: PublicVerificationClient = retailTraceApi,
) {
  return async function verifyPublicRecord(recordId: string): Promise<PublicVerificationResult> {
    if (!isValidRetailTraceRecordId(recordId)) {
      return { status: "NOT_VERIFIED" };
    }

    const sync = await repository.findOrderSyncByRecordId(recordId);
    if (!sync || sync.entityType !== "Order" || !sync.retailTraceRecordId) {
      return { status: "NOT_VERIFIED" };
    }

    const details = detailsFor(sync);
    const hasPublicationEvidence =
      Boolean(sync.transactionId) ||
      sync.syncStatus === "SYNCED" ||
      sync.retailTraceStatus === "CONFIRMED";
    if (!hasPublicationEvidence) {
      if (
        sync.retailTraceStatus === "FAILED" ||
        sync.syncStatus === "FAILED"
      ) {
        return { status: "NOT_VERIFIED", ...details };
      }
      return { status: "PENDING", ...details };
    }

    try {
      const verification = await verificationClient.verifyRecord(recordId);
      const transactionId = verification.transactionId ?? sync.transactionId;
      const matchesStoredTransaction =
        !sync.transactionId ||
        !verification.transactionId ||
        sync.transactionId === verification.transactionId;
      const verified =
        verification.recordId === recordId &&
        verification.verified &&
        matchesStoredTransaction;

      return {
        status: verified ? "VERIFIED" : "NOT_VERIFIED",
        ...details,
        publicationStatus: verified
          ? "CONFIRMED"
          : details.publicationStatus ?? null,
        transactionId,
      };
    } catch (error) {
      if (
        error instanceof RetailTraceApiError &&
        (error.upstreamStatus === 400 || error.upstreamStatus === 404)
      ) {
        return { status: "NOT_VERIFIED", ...details };
      }
      return { status: "UNAVAILABLE", ...details };
    }
  };
}

export const verifyPublicRecord = createPublicVerificationService();
