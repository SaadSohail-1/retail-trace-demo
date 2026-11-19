import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importSchemaDefinition } from "./schema-import.ts";

describe("Verdant schema import adapter", () => {
  it("converts the supplied JSON Schema required fields", () => {
    const result = importSchemaDefinition({
      type: "object",
      properties: { supplierName: { type: "string" }, email: { type: "string" } },
      additionalProperties: false,
      required: ["supplierName", "email"],
    });
    assert.equal(result.name, "");
    assert.deepEqual(result.fields, [
      { name: "supplierName", type: "string", required: true },
      { name: "email", type: "string", required: true },
    ]);
  });

  it("keeps optional fields and supported primitive constraints", () => {
    const result = importSchemaDefinition({
      title: "Supplier",
      type: "object",
      properties: {
        supplierName: { type: "string", minLength: 2, pattern: "^[A-Z]" },
        amount: { type: "number", minimum: 0 },
        active: { type: "boolean" },
      },
      required: ["amount", "active"],
    });
    assert.equal(result.name, "Supplier");
    assert.equal(result.fields[0]?.required, false);
    assert.deepEqual(result.fields[0]?.constraints, { minLength: 2, pattern: "^[A-Z]" });
    assert.equal(result.fields[1]?.type, "number");
    assert.equal(result.fields[2]?.type, "boolean");
  });

  it("continues to accept native RetailTrace files", () => {
    const result = importSchemaDefinition({
      name: "BrunoSupplier",
      fields: [{ name: "supplierName", type: "string", required: true }],
    });
    assert.equal(result.name, "BrunoSupplier");
    assert.equal(result.fields.length, 1);
  });

  it("rejects unsupported keywords instead of discarding them", () => {
    assert.throws(() => importSchemaDefinition({
      type: "object",
      properties: { email: { type: "string", format: "email" } },
    }), /format.*unsupported/);
    assert.throws(() => importSchemaDefinition({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    }), /unsupported/);
  });
});
