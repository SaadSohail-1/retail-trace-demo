import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompatibilityReport,
  findCompatibleSchema,
  parsePrismaModels,
  schemaFieldsMatch,
  type RetailTraceSchemaReader,
} from "../services/schema-compatibility.service.js";
import { RetailTraceApiError } from "../services/integration-errors.js";
import type {
  RetailTraceSchema,
  RetailTraceSchemaField,
} from "../services/retailtrace-api.service.js";

const scalarOrderFields: RetailTraceSchemaField[] = [
  { name: "customerName", type: "string", required: true },
  { name: "total", type: "number", required: true },
  { name: "status", type: "string", required: true },
  {
    name: "product1",
    type: "reference",
    targetSchemaId: "product-schema",
    required: true,
  },
  { name: "quantity1", type: "integer", required: true },
];

function createSchema(
  schemaId: string,
  name: string,
  fields: RetailTraceSchemaField[],
): RetailTraceSchema {
  return { schemaId, name, version: 1, fields, schema: {} };
}

function createReader(schemas: RetailTraceSchema[]): RetailTraceSchemaReader {
  return {
    async listSchemas() {
      return schemas.map(({ schemaId, name, version }) => ({ schemaId, name, version }));
    },
    async getSchema(schemaId) {
      const schema = schemas.find((candidate) => candidate.schemaId === schemaId);
      if (!schema) {
        throw new RetailTraceApiError(502, "SCHEMA_NOT_FOUND", "Missing schema", 404);
      }
      return schema;
    },
  };
}

describe("RetailTrace schema compatibility", () => {
  it("reads actual Prisma fields and compares renamed fields only with explicit mappings", () => {
    const [model] = parsePrismaModels(`model Supplier {\n  id String @id\n  name String\n  email String?\n}`);
    assert.deepEqual(model?.fields, [
      { name: "id", databaseType: "String", required: true },
      { name: "name", databaseType: "String", required: true },
      { name: "email", databaseType: "String", required: false },
    ]);
    const schema = createSchema("supplier-schema", "Supplier", [
      { name: "supplierName", type: "string", required: true },
      { name: "email", type: "string", required: false },
    ]);
    const unmapped = buildCompatibilityReport(model!, schema, {}, {}, false);
    assert.equal(unmapped.rows.find((row) => row.databaseField === "name")?.status, "Missing in RetailTrace");
    const mapped = buildCompatibilityReport(model!, schema, { name: "supplierName" }, {}, false);
    assert.equal(mapped.rows.find((row) => row.databaseField === "name")?.status, "Matched");
    assert.equal(mapped.configurationSaved, false);
    assert.ok(mapped.warnings.some((warning) => warning.includes("unsaved mapping preview")));
  });

  it("builds a read-only database compatibility report with scores and warnings", () => {
    const schema = createSchema("supplier-1", "Supplier", [
      { name: "name", type: "string", required: true },
      { name: "email", type: "string", required: true },
      { name: "country", type: "string", required: true },
      { name: "active", type: "boolean", required: true },
    ]);
    const report = buildCompatibilityReport(
      {
        entity: "Supplier",
        fields: [
          { name: "name", databaseType: "String", required: true },
          { name: "email", databaseType: "String", required: true },
          { name: "country", databaseType: "String", required: true },
          { name: "active", databaseType: "Boolean", required: true },
          { name: "createdAt", databaseType: "DateTime", required: true },
        ],
      },
      schema,
      {},
      {},
      false,
    );

    assert.equal(report.score, 80);
    assert.equal(report.compatibleFieldCount, 4);
    assert.equal(report.mappedFieldCount, 5);
    assert.ok(report.rows.some((row) => row.status === "Missing in RetailTrace"));
  });
  it("rejects multiple references where Verdant sends a scalar reference", () => {
    const fields = [
      ...scalarOrderFields.slice(0, 3),
      {
        ...scalarOrderFields[3]!,
        multiple: true,
      },
      scalarOrderFields[4]!,
    ];

    assert.equal(schemaFieldsMatch(fields, scalarOrderFields), false);
  });

  it("rejects incompatible required fields and reference targets", () => {
    const wrongRequired = scalarOrderFields.map((field) =>
      field.name === "quantity1" ? { ...field, required: false } : field,
    );
    const wrongReference = scalarOrderFields.map((field) =>
      field.name === "product1" ? { ...field, targetSchemaId: "other-product-schema" } : field,
    );

    assert.equal(schemaFieldsMatch(wrongRequired, scalarOrderFields), false);
    assert.equal(schemaFieldsMatch(wrongReference, scalarOrderFields), false);
  });

  it("does not select a legacy schema with incompatible required fields", async () => {
    const fields = scalarOrderFields.map((field) =>
      field.name === "quantity1" ? { ...field, required: false } : field,
    );
    const reader = createReader([createSchema("legacy-order", "Order", fields)]);
    const match = await findCompatibleSchema(
      reader,
      "Order",
      scalarOrderFields,
      "legacy-order",
    );

    assert.equal(match, undefined);
  });

  it("reuses a compatible scalar-reference schema", async () => {
    const schema = createSchema("scalar-order", "Order", scalarOrderFields);
    const reader = createReader([schema]);
    const match = await findCompatibleSchema(
      reader,
      "Order",
      scalarOrderFields,
      null,
    );

    assert.deepEqual(match, {
      schemaId: "scalar-order",
      name: "Order",
      version: 1,
    });
  });

  it("does not reuse schemas with extra or missing fields", () => {
    assert.equal(
      schemaFieldsMatch(scalarOrderFields.slice(0, -1), scalarOrderFields),
      false,
    );
    assert.equal(
      schemaFieldsMatch(
        [...scalarOrderFields, { name: "legacy", type: "string", required: false }],
        scalarOrderFields,
      ),
      false,
    );
  });
});
