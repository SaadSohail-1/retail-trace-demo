/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePublicVerification,
  publicVerificationTitle,
} from "./public-verification.ts";

describe("public verification status presentation", () => {
  it("preserves a confirmed, fully verified backend result as VERIFIED", () => {
    const result = parsePublicVerification({
      status: "VERIFIED",
      orderReference: "ORD-E6800B36AE",
      recordId: "6afebc7e7c566c6fcaec5004",
      publicationStatus: "CONFIRMED",
      transactionId: "a".repeat(64),
      confirmations: 11,
      verificationTimestamp: "2026-11-19T09:00:00.000Z",
      checks: {
        transactionExists: true,
        recordFound: true,
        commitmentMatches: true,
      },
      explanation: "The transaction is confirmed and the commitment matches.",
    });

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.publicationStatus, "CONFIRMED");
    assert.equal(result.confirmations, 11);
    assert.deepEqual(result.checks, {
      transactionExists: true,
      recordFound: true,
      commitmentMatches: true,
    });
    assert.equal(publicVerificationTitle(result.status), "Blockchain record verified");
  });
});
