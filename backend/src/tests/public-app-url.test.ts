import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublicAppUrl } from "../config/env.js";

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
