import { RetailTraceApiError } from "./integration-errors.js";
import type {
  RetailTraceSchema,
  RetailTraceSchemaField,
  RetailTraceSchemaSummary,
} from "./retailtrace-api.service.js";

export interface RetailTraceSchemaReader {
  listSchemas(): Promise<RetailTraceSchemaSummary[]>;
  getSchema(schemaId: string): Promise<RetailTraceSchema>;
}

export type CompatibilityStatus =
  | "Matched"
  | "Type mismatch"
  | "Missing in RetailTrace"
  | "Extra in RetailTrace"
  | "Reference mismatch"
  | "Not mapped";

export interface DatabaseFieldMetadata {
  name: string;
  databaseType: string;
  reference?: { targetEntity: string; retailTraceField?: string };
  required: boolean;
}

export interface CompatibilityRow {
  databaseField: string;
  databaseType: string;
  retailTraceField: string | null;
  retailTraceType: string | null;
  required: boolean;
  retailTraceRequired: boolean | null;
  status: CompatibilityStatus;
  detail: string;
}

export interface CompatibilityReport {
  entity: string;
  schemaId: string;
  schemaName: string;
  score: number;
  compatibleFieldCount: number;
  mappedFieldCount: number;
  rows: CompatibilityRow[];
  warnings: string[];
}

const verdantDatabaseMetadata: Record<string, DatabaseFieldMetadata[]> = {
  Supplier: [
    { name: "id", databaseType: "String (CUID)", required: true },
    { name: "name", databaseType: "String", required: true },
    { name: "email", databaseType: "String", required: true },
    { name: "country", databaseType: "String", required: true },
    { name: "active", databaseType: "Boolean", required: true },
  ],
  Product: [
    { name: "id", databaseType: "String (CUID)", required: true },
    { name: "name", databaseType: "String", required: true },
    { name: "price", databaseType: "Decimal(10,2)", required: true },
    { name: "stockQuantity", databaseType: "Int", required: true },
    { name: "organic", databaseType: "Boolean", required: true },
    { name: "manufacturedOn", databaseType: "Date", required: true },
    { name: "supplierId", databaseType: "String (CUID)", required: true, reference: { targetEntity: "Supplier" } },
  ],
  Order: [
    { name: "id", databaseType: "String (CUID)", required: true },
    { name: "customerName", databaseType: "String", required: true },
    { name: "total", databaseType: "Decimal(10,2)", required: true },
    { name: "status", databaseType: "String", required: true },
  ],
};

function retailTraceTypeMatches(databaseType: string, retailTraceType: string): boolean {
  if (databaseType.startsWith("Decimal")) return retailTraceType === "number";
  if (databaseType === "Int") return retailTraceType === "integer";
  if (databaseType === "Boolean") return retailTraceType === "boolean";
  if (databaseType === "Date") return retailTraceType === "date";
  if (databaseType.startsWith("String")) return retailTraceType === "string";
  return false;
}

export function buildCompatibilityReport(
  entity: keyof typeof verdantDatabaseMetadata,
  schema: RetailTraceSchema,
): CompatibilityReport {
  const rows: CompatibilityRow[] = [];
  const warnings: string[] = [];
  const databaseFields = verdantDatabaseMetadata[entity] ?? [];

  for (const databaseField of databaseFields) {
    const retailTraceField = schema.fields.find((field) => field.name === databaseField.name);
    if (!retailTraceField) {
      rows.push({
        databaseField: databaseField.name,
        databaseType: databaseField.databaseType,
        retailTraceField: null,
        retailTraceType: null,
        required: databaseField.required,
        retailTraceRequired: null,
        status: "Missing in RetailTrace",
        detail: "This database field is not represented in the registered schema.",
      });
      warnings.push(`Database field '${databaseField.name}' is missing in RetailTrace.`);
      continue;
    }

    let status: CompatibilityStatus = "Matched";
    let detail = "Database field and RetailTrace field are compatible.";
    if (databaseField.reference && retailTraceField.type !== "reference") {
      status = "Reference mismatch";
      detail = "Database relationship is not declared as a RetailTrace reference.";
    } else if (
      !databaseField.reference &&
      retailTraceField.type === "reference"
    ) {
      status = "Reference mismatch";
      detail = "RetailTrace declares a reference, but the database field is scalar.";
    } else if (
      retailTraceField.type !== "reference" &&
      !retailTraceTypeMatches(databaseField.databaseType, retailTraceField.type)
    ) {
      status = "Type mismatch";
      detail = `Database type '${databaseField.databaseType}' does not map safely to '${retailTraceField.type}'.`;
    } else if (
      databaseField.reference &&
      retailTraceField.type === "reference" &&
      !retailTraceField.targetSchemaId
    ) {
      status = "Reference mismatch";
      detail = "Reference targetSchemaId is missing.";
    }
    if (databaseField.required && !retailTraceField.required) {
      warnings.push(`Database field '${databaseField.name}' is required but is optional in RetailTrace.`);
    }
    rows.push({
      databaseField: databaseField.name,
      databaseType: databaseField.databaseType,
      retailTraceField: retailTraceField.name,
      retailTraceType: retailTraceField.type,
      required: databaseField.required,
      retailTraceRequired: retailTraceField.required,
      status,
      detail,
    });
  }

  for (const retailTraceField of schema.fields) {
    if (!databaseFields.some((field) => field.name === retailTraceField.name)) {
      rows.push({
        databaseField: "",
        databaseType: "",
        retailTraceField: retailTraceField.name,
        retailTraceType: retailTraceField.type,
        required: false,
        retailTraceRequired: retailTraceField.required,
        status: "Extra in RetailTrace",
        detail: "RetailTrace has a field that is not mapped to the database entity.",
      });
      warnings.push(`RetailTrace field '${retailTraceField.name}' is extra or unmapped.`);
    }
  }

  const mappedRows = rows.filter((row) => row.databaseField);
  const compatibleFieldCount = rows.filter((row) => row.status === "Matched").length;
  const score = mappedRows.length === 0
    ? 0
    : Math.round((compatibleFieldCount / mappedRows.length) * 100);
  if (score < 100) warnings.push("A high score does not verify relationship values or actual record data.");
  return {
    entity,
    schemaId: schema.schemaId,
    schemaName: schema.name,
    score,
    compatibleFieldCount,
    mappedFieldCount: mappedRows.length,
    rows,
    warnings,
  };
}

export function schemaFieldsMatch(
  actual: RetailTraceSchemaField[],
  expected: RetailTraceSchemaField[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  return expected.every((field) => {
    const candidate = actual.find((item) => item.name === field.name);
    if (
      !candidate ||
      candidate.type !== field.type ||
      candidate.required !== field.required ||
      (candidate.multiple === true) !== (field.multiple === true)
    ) {
      return false;
    }

    if (field.type === "reference") {
      return (
        candidate.targetSchemaId === field.targetSchemaId &&
        candidate.multiple !== true
      );
    }
    return candidate.targetSchemaId === undefined;
  });
}

export async function findCompatibleSchema(
  reader: RetailTraceSchemaReader,
  name: string,
  fields: RetailTraceSchemaField[],
  savedSchemaId: string | null,
  existingSchemas?: RetailTraceSchemaSummary[],
): Promise<RetailTraceSchemaSummary | undefined> {
  const summaries = existingSchemas ?? await reader.listSchemas();
  const candidates = summaries
    .filter((schema) => schema.name === name)
    .sort((left, right) => right.version - left.version);
  const details = new Map<string, RetailTraceSchema | null>();

  const readSchema = async (
    schemaId: string,
  ): Promise<RetailTraceSchema | undefined> => {
    if (details.has(schemaId)) {
      return details.get(schemaId) ?? undefined;
    }

    try {
      const schema = await reader.getSchema(schemaId);
      details.set(schemaId, schema);
      return schema;
    } catch (error) {
      if (error instanceof RetailTraceApiError && error.upstreamStatus === 404) {
        details.set(schemaId, null);
        return undefined;
      }
      throw error;
    }
  };

  if (savedSchemaId) {
    const savedSchema = await readSchema(savedSchemaId);
    if (
      savedSchema?.name === name &&
      schemaFieldsMatch(savedSchema.fields, fields)
    ) {
      return {
        schemaId: savedSchema.schemaId,
        name: savedSchema.name,
        version: savedSchema.version,
      };
    }
  }

  for (const candidate of candidates) {
    const schema = await readSchema(candidate.schemaId);
    if (schema?.name === name && schemaFieldsMatch(schema.fields, fields)) {
      return {
        schemaId: schema.schemaId,
        name: schema.name,
        version: schema.version,
      };
    }
  }
  return undefined;
}
