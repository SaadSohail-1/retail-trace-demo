import { createHash } from "node:crypto";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import type { RetailTraceSync } from "../generated/prisma/client.js";
import {
  type RetailTracePublicTransactionVerification,
  type RetailTraceRecord,
} from "./retailtrace-api.service.js";
import { retailTraceApi } from "./retailtrace-api.service.js";
import { RetailTraceApiError } from "./integration-errors.js";

export type PublicVerificationStatus =
  | "VERIFIED"
  | "NOT_VERIFIED"
  | "PENDING"
  | "UNAVAILABLE";

export interface PublicOrderProduct {
  name: string;
  quantity: number;
}

export interface PublicOrderDetails {
  status: "FOUND" | "NOT_FOUND";
  orderReference?: string;
  retailTraceRecordId?: string;
  orderDate?: string;
  products?: PublicOrderProduct[];
  total?: string;
  transactionId?: string | null;
  publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
}

export interface PublicRetailTraceRecord {
  status: "FOUND" | "NOT_FOUND" | "PENDING" | "UNAVAILABLE";
  recordId?: string;
  transactionId?: string | null;
  publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
  publicationTimestamp?: string;
}

export interface PublicVerificationChecks {
  transactionExists: boolean | null;
  recordFound: boolean | null;
  commitmentMatches: boolean | null;
}

export interface PublicVerificationResult {
  status: PublicVerificationStatus;
  orderReference?: string;
  recordId?: string;
  transactionId?: string | null;
  publicationStatus?: "PENDING" | "CONFIRMED" | "FAILED" | null;
  publicationTimestamp?: string;
  network?: string;
  streamName?: string;
  commitmentHash?: string;
  confirmations?: number;
  blockHeight?: number;
  verificationTimestamp: string;
  checks: PublicVerificationChecks;
  independentVerificationUrl?: string;
  explanation: string;
}

interface PublicOrderRow {
  createdAt: Date;
  total: { toFixed(decimalPlaces?: number): string };
  items: Array<{
    quantity: number;
    product: { name: string };
  }>;
}

export interface PublicVerificationRepository {
  findOrderSyncByRecordId(recordId: string): Promise<RetailTraceSync | null>;
  findOrderById(localEntityId: string): Promise<PublicOrderRow | null>;
}

export interface PublicVerificationClient {
  getRecord(recordId: string): ReturnType<typeof retailTraceApi.getRecord>;
  verifyPublicTransaction(
    transactionId: string,
  ): ReturnType<typeof retailTraceApi.verifyPublicTransaction>;
}

const prismaRepository: PublicVerificationRepository = {
  findOrderSyncByRecordId: (recordId) =>
    prisma.retailTraceSync.findFirst({
      where: {
        entityType: "Order",
        retailTraceRecordId: recordId,
      },
    }),
  async findOrderById(localEntityId) {
    return prisma.order.findUnique({
      where: { id: localEntityId },
      select: {
        createdAt: true,
        total: true,
        items: {
          select: {
            quantity: true,
            product: { select: { name: true } },
          },
          orderBy: { productId: "asc" },
        },
      },
    });
  },
};

function isValidRetailTraceRecordId(recordId: string): boolean {
  return /^[a-f\d]{24}$/i.test(recordId);
}

function publicOrderReference(localOrderId: string): string {
  const suffix = createHash("sha256").update(localOrderId).digest("hex").slice(0, 10);
  return `ORD-${suffix.toUpperCase()}`;
}

function publicationStatus(
  status: string | null | undefined,
): "PENDING" | "CONFIRMED" | "FAILED" | null {
  return status === "PENDING" || status === "CONFIRMED" || status === "FAILED"
    ? status
    : null;
}

function independentVerificationUrl(
  transactionId: string,
  publicBaseUrl: string | null,
): string | undefined {
  if (!publicBaseUrl) return undefined;
  const url = new URL("/verify", publicBaseUrl);
  url.searchParams.set("txid", transactionId);
  return url.toString();
}

function isMissingRetailTraceRecord(error: unknown): boolean {
  return error instanceof RetailTraceApiError &&
    (error.upstreamStatus === 400 || error.upstreamStatus === 404);
}

function unavailableResult(
  verificationTimestamp: string,
  explanation: string,
  details: Partial<PublicVerificationResult> = {},
): PublicVerificationResult {
  return {
    status: "UNAVAILABLE",
    ...details,
    verificationTimestamp,
    checks: {
      transactionExists: null,
      recordFound: null,
      commitmentMatches: null,
    },
    explanation,
  };
}

export function createPublicOrderLookupService(
  repository: PublicVerificationRepository = prismaRepository,
) {
  return async function getPublicOrder(recordId: string): Promise<PublicOrderDetails> {
    if (!isValidRetailTraceRecordId(recordId)) return { status: "NOT_FOUND" };

    const sync = await repository.findOrderSyncByRecordId(recordId);
    if (
      !sync ||
      sync.entityType !== "Order" ||
      sync.retailTraceRecordId !== recordId
    ) {
      return { status: "NOT_FOUND" };
    }

    const order = await repository.findOrderById(sync.localEntityId);
    if (!order) return { status: "NOT_FOUND" };

    return {
      status: "FOUND",
      orderReference: publicOrderReference(sync.localEntityId),
      retailTraceRecordId: recordId,
      orderDate: order.createdAt.toISOString(),
      products: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
      })),
      total: order.total.toFixed(2),
      transactionId: sync.transactionId,
      publicationStatus: publicationStatus(sync.retailTraceStatus),
    };
  };
}

export function createPublicRecordLookupService(
  repository: PublicVerificationRepository = prismaRepository,
  client: Pick<PublicVerificationClient, "getRecord"> = retailTraceApi,
) {
  return async function getPublicRetailTraceRecord(
    recordId: string,
  ): Promise<PublicRetailTraceRecord> {
    if (!isValidRetailTraceRecordId(recordId)) return { status: "NOT_FOUND" };
    const sync = await repository.findOrderSyncByRecordId(recordId);
    if (
      !sync ||
      sync.entityType !== "Order" ||
      sync.retailTraceRecordId !== recordId
    ) {
      return { status: "NOT_FOUND" };
    }

    try {
      const record = await client.getRecord(recordId);
      if (record.recordId !== recordId) return { status: "NOT_FOUND" };
      const transactionId = record.transactionId ?? sync.transactionId;
      if (!transactionId) {
        return {
          status: record.status === "FAILED" ? "NOT_FOUND" : "PENDING",
          recordId,
          transactionId: null,
          publicationStatus: publicationStatus(record.status),
        };
      }
      return {
        status: "FOUND",
        recordId,
        transactionId,
        publicationStatus: publicationStatus(record.status),
        publicationTimestamp: record.createdAt,
      };
    } catch (error) {
      if (isMissingRetailTraceRecord(error)) return { status: "NOT_FOUND" };
      if (error instanceof RetailTraceApiError) {
        return { status: "UNAVAILABLE" };
      }
      throw error;
    }
  };
}

export function createPublicVerificationService(
  repository: PublicVerificationRepository = prismaRepository,
  client: PublicVerificationClient = retailTraceApi,
  now: () => Date = () => new Date(),
  getPublicRetailTraceUrl: () => string | null = () => env.publicRetailTraceUrl,
) {
  return async function verifyPublicRecord(
    recordId: string,
  ): Promise<PublicVerificationResult> {
    const verifiedAt = now().toISOString();
    if (!isValidRetailTraceRecordId(recordId)) {
      return {
        status: "NOT_VERIFIED",
        verificationTimestamp: verifiedAt,
        checks: {
          transactionExists: null,
          recordFound: false,
          commitmentMatches: null,
        },
        explanation: "This order's RetailTrace record could not be found.",
      };
    }

    const sync = await repository.findOrderSyncByRecordId(recordId);
    if (
      !sync ||
      sync.entityType !== "Order" ||
      sync.retailTraceRecordId !== recordId
    ) {
      return {
        status: "NOT_VERIFIED",
        verificationTimestamp: verifiedAt,
        checks: {
          transactionExists: null,
          recordFound: false,
          commitmentMatches: null,
        },
        explanation: "This order's RetailTrace record could not be found.",
      };
    }

    const orderReference = publicOrderReference(sync.localEntityId);
    let record: RetailTraceRecord;
    try {
      record = await client.getRecord(recordId);
    } catch (error) {
      const details: Partial<PublicVerificationResult> = {
        orderReference,
        recordId,
      };
      if (isMissingRetailTraceRecord(error)) {
        return {
          status: "NOT_VERIFIED",
          ...details,
          verificationTimestamp: verifiedAt,
          checks: {
            transactionExists: null,
            recordFound: false,
            commitmentMatches: null,
          },
          explanation: "RetailTrace could not find the published record.",
        };
      }
      if (error instanceof RetailTraceApiError) {
        return unavailableResult(
          verifiedAt,
          "RetailTrace is temporarily unavailable.",
          details,
        );
      }
      throw error;
    }

    if (record.recordId !== recordId) {
      return {
        status: "NOT_VERIFIED",
        orderReference,
        recordId,
        verificationTimestamp: verifiedAt,
        checks: {
          transactionExists: null,
          recordFound: false,
          commitmentMatches: null,
        },
        explanation: "RetailTrace returned a different record than the one requested.",
      };
    }

    const transactionId = record.transactionId ?? sync.transactionId;
    if (!transactionId) {
      const pending = record.status !== "FAILED" &&
        (sync.submissionUncertain || sync.syncStatus !== "FAILED");
      return {
        status: pending ? "PENDING" : "NOT_VERIFIED",
        orderReference,
        recordId,
        transactionId: null,
        publicationStatus: publicationStatus(record.status) ??
          publicationStatus(sync.retailTraceStatus),
        publicationTimestamp: record.createdAt,
        verificationTimestamp: verifiedAt,
        checks: {
          transactionExists: false,
          recordFound: true,
          commitmentMatches: null,
        },
        explanation: pending
          ? "The RetailTrace record is waiting for blockchain publication."
          : "The RetailTrace record has no confirmed blockchain transaction.",
      };
    }

    let transaction: RetailTracePublicTransactionVerification;
    try {
      transaction = await client.verifyPublicTransaction(transactionId);
    } catch (error) {
      if (error instanceof RetailTraceApiError) {
        return unavailableResult(
          verifiedAt,
          "RetailTrace or the blockchain verification service is temporarily unavailable.",
          { orderReference, recordId, transactionId },
        );
      }
      throw error;
    }

    const recordMatches =
      transaction.recordId === recordId &&
      transaction.transactionId.toLowerCase() === transactionId.toLowerCase();
    const checks: PublicVerificationChecks =
      transaction.status === "UNAVAILABLE"
        ? {
            transactionExists: null,
            recordFound: null,
            commitmentMatches: null,
          }
        : {
            transactionExists: transaction.transactionExists,
            recordFound: transaction.recordFound && recordMatches,
            commitmentMatches: recordMatches ? transaction.commitmentMatches : null,
          };
    const status: PublicVerificationStatus =
      transaction.status === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : transaction.status === "UNCONFIRMED"
          ? transaction.publicationStatus === "FAILED" ? "NOT_VERIFIED" : "PENDING"
          : transaction.status === "VERIFIED" &&
              recordMatches &&
              transaction.transactionExists &&
              transaction.recordFound &&
              transaction.commitmentMatches === true
            ? "VERIFIED"
            : "NOT_VERIFIED";

    const independentUrl = independentVerificationUrl(
      transactionId,
      getPublicRetailTraceUrl(),
    );
    return {
      status,
      orderReference,
      recordId,
      transactionId,
      publicationStatus: transaction.publicationStatus === "UNKNOWN"
        ? publicationStatus(record.status) ?? publicationStatus(sync.retailTraceStatus)
        : transaction.publicationStatus,
      ...(transaction.publicationTimestamp
        ? { publicationTimestamp: transaction.publicationTimestamp }
        : {}),
      network: transaction.network,
      ...(transaction.streamName ? { streamName: transaction.streamName } : {}),
      ...(transaction.commitmentHash
        ? { commitmentHash: transaction.commitmentHash }
        : {}),
      ...(transaction.confirmations !== undefined
        ? { confirmations: transaction.confirmations }
        : {}),
      ...(transaction.blockHeight !== undefined
        ? { blockHeight: transaction.blockHeight }
        : {}),
      verificationTimestamp: verifiedAt,
      checks,
      ...(independentUrl ? { independentVerificationUrl: independentUrl } : {}),
      explanation:
        status === "VERIFIED"
          ? "The transaction is confirmed and the published commitment matches this order's RetailTrace record."
          : status === "PENDING"
            ? "The record commitment matches, but the blockchain transaction is not yet confirmed."
            : status === "UNAVAILABLE"
              ? "RetailTrace or the blockchain verification service is temporarily unavailable."
              : transaction.explanation,
    };
  };
}

export const getPublicOrder = createPublicOrderLookupService();
export const getPublicRetailTraceRecord = createPublicRecordLookupService();
export const verifyPublicRecord = createPublicVerificationService();
