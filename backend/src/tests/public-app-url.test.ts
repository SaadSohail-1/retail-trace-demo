import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPublicAppUrl,
  getPublicRetailTraceUrl,
} from "../config/env.js";

describe("Public application URL", () => {
  it("accepts and normalizes a public HTTPS origin", () => {
    assert.equal(
      getPublicAppUrl("https://store.example.com/"),
      "https://store.example.com",
    );
  });

  it("rejects insecure, local, and private application URLs", () => {
    for (const url of [
      "http://store.example.com",
      "https://localhost",
      "https://127.0.0.1",
      "https://192.168.1.20",
      "https://[::1]",
    ]) {
      assert.throws(() => getPublicAppUrl(url));
    }
  });

  it("leaves QR links disabled when no public origin is configured", () => {
    assert.equal(getPublicAppUrl(undefined), null);
  });
});

describe("Public RetailTrace URL", () => {
  it("accepts a configured public verification site and rejects private origins", () => {
    assert.equal(
      getPublicRetailTraceUrl("https://trace.example.com/"),
      "https://trace.example.com",
    );
    assert.throws(() => getPublicRetailTraceUrl("http://localhost:5173"));
    assert.equal(getPublicRetailTraceUrl(undefined), null);
  });
});
