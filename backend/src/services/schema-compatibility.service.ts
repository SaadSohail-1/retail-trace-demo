import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  | "Requiredness mismatch"
  | "Not mapped";

export interface DatabaseFieldMetadata {
  name: string;
  databaseType: string;
  reference?: { targetEntity: string };
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

export interface PrismaModelMetadata {
  entity: string;
  fields: DatabaseFieldMetadata[];
}

export interface StoredSchemaMapping {
  modelName: string;
  fieldMappings: Record<string, string>;
}

export interface CompatibilityReport {
  entity: string;
  schemaId: string;
  schemaName: string;
  score: number;
  compatibleFieldCount: number;
  mappedFieldCount: number;
  configurationSaved: boolean;
  rows: CompatibilityRow[];
  warnings: string[];
}

const prismaScalarTypes = new Set([
  "String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Bytes", "Json",
]);

export function parsePrismaModels(schemaSource: string): PrismaModelMetadata[] {
  const enumNames = new Set(
    [...schemaSource.matchAll(/\benum\s+(\w+)\s*\{/g)].map((match) => match[1]!),
  );
  const modelBlocks = [...schemaSource.matchAll(/\bmodel\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(modelBlocks.map((match) => match[1]!));
  return modelBlocks.map(([, entity, body]) => {
    const lines = body!.split("\n").map((line) => line.split("//")[0]!.trim()).filter(Boolean);
    const rawFields = lines.flatMap((line) => {
      const match = line.match(/^(\w+)\s+([A-Za-z]\w*)(\?)?(\[\])?(?:\s+(.*))?$/);
      if (!match) return [];
      const [, name, baseType, optional, array, attributes = ""] = match;
      return [{ name: name!, baseType: baseType!, optional: Boolean(optional), array: Boolean(array), attributes }];
    });
    const relations = new Map<string, string>();
    for (const field of rawFields) {
      if (!modelNames.has(field.baseType)) continue;
      const scalarForeignKeys = field.attributes.match(/@relation\([^)]*fields:\s*\[([^\]]+)\]/)?.[1];
      for (const foreignKey of scalarForeignKeys?.split(",").map((part) => part.trim()) ?? []) {
        relations.set(foreignKey, field.baseType);
      }
    }

    const fields = rawFields.flatMap((field): DatabaseFieldMetadata[] => {
      const { name, baseType, optional, array } = field;
      if (modelNames.has(baseType)) return [];
      const type = enumNames.has(baseType) ? `Enum(${baseType})` : baseType;
      if (!prismaScalarTypes.has(baseType) && !enumNames.has(baseType)) return [];
      const dbType = baseType === "DateTime" && /@db\.Date\b/.test(field.attributes)
        ? "Date"
        : type;
      const targetEntity = relations.get(name);
      return [{
        name,
        databaseType: `${dbType}${array ? "[]" : ""}`,
        required: !optional && !array,
        ...(targetEntity ? { reference: { targetEntity } } : {}),
      }];
    });
    return { entity: entity!, fields };
  });
}

export async function getPrismaModels(): Promise<PrismaModelMetadata[]> {
  let lastError: unknown;
  for (const path of [
    resolve(process.cwd(), "prisma/schema.prisma"),
    resolve(process.cwd(), "backend/prisma/schema.prisma"),
  ]) {
    try {
      return parsePrismaModels(await readFile(path, "utf8"));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error("Could not read the configured Prisma schema file", { cause: lastError });
}

function retailTraceTypeMatches(databaseType: string, retailTraceType: string): boolean {
  if (databaseType === "Decimal" || databaseType === "Float") return retailTraceType === "number";
  if (databaseType === "Int" || databaseType === "BigInt") return retailTraceType === "integer";
  if (databaseType === "Boolean") return retailTraceType === "boolean";
  if (databaseType === "Date") return retailTraceType === "date";
  if (databaseType === "DateTime") return retailTraceType === "date";
  if (databaseType === "String" || databaseType.startsWith("Enum(")) return retailTraceType === "string";
  return false;
}

export function buildCompatibilityReport(
  model: PrismaModelMetadata,
  schema: RetailTraceSchema,
  fieldMappings: Record<string, string>,
  targetSchemaModels: Record<string, string>,
  configurationSaved: boolean,
): CompatibilityReport {
  const rows: CompatibilityRow[] = [];
  const warnings: string[] = [];
  const usedRetailTraceFields = new Set<string>();

  for (const databaseField of model.fields) {
    const retailTraceName = fieldMappings[databaseField.name] ?? databaseField.name;
    const retailTraceField = schema.fields.find((field) => field.name === retailTraceName);
    if (!retailTraceField) {
      rows.push({
        databaseField: databaseField.name,
        databaseType: databaseField.databaseType,
        retailTraceField: null,
        retailTraceType: null,
        required: databaseField.required,
        retailTraceRequired: null,
        status: "Missing in RetailTrace",
        detail: fieldMappings[databaseField.name]
          ? `Mapped RetailTrace field '${retailTraceName}' does not exist in this schema.`
          : "This database field is not represented in the registered schema; add an explicit field mapping if it has a different name.",
      });
      warnings.push(`Database field '${databaseField.name}' is missing in RetailTrace.`);
      continue;
    }
    usedRetailTraceFields.add(retailTraceField.name);

    let status: CompatibilityStatus = "Matched";
    let detail = databaseField.name === retailTraceField.name
      ? "Database field and RetailTrace field are compatible."
      : `Explicit mapping: Prisma '${databaseField.name}' → RetailTrace '${retailTraceField.name}'.`;
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
      !retailTraceTypeMatches(databaseField.databaseType.replace(/\[\]$/, ""), retailTraceField.type)
    ) {
      status = "Type mismatch";
      detail = `Database type '${databaseField.databaseType}' does not map safely to '${retailTraceField.type}'.`;
    } else if (
      databaseField.reference &&
      retailTraceField.type === "reference" &&
      (!retailTraceField.targetSchemaId ||
        targetSchemaModels[retailTraceField.targetSchemaId] !== databaseField.reference.targetEntity)
    ) {
      status = "Reference mismatch";
      detail = targetSchemaModels[retailTraceField.targetSchemaId ?? ""] === undefined
        ? `Reference target is not mapped to Prisma model '${databaseField.reference.targetEntity}'.`
        : `Reference target maps to '${targetSchemaModels[retailTraceField.targetSchemaId!]}' rather than '${databaseField.reference.targetEntity}'.`;
    }
    if (status === "Matched" && databaseField.required !== retailTraceField.required) {
      status = "Requiredness mismatch";
      detail = databaseField.required
        ? "Prisma field is required but its RetailTrace field is optional."
        : "Prisma field is optional but its RetailTrace field is required.";
    }
    if (status !== "Matched") {
      warnings.push(`${databaseField.name}: ${detail}`);
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
    if (!usedRetailTraceFields.has(retailTraceField.name)) {
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
  if (!configurationSaved) {
    warnings.push("This is an unsaved mapping preview; save the explicit model/field mapping to configure it.");
  }
  warnings.push("The score covers matched Prisma scalar fields only; it does not verify record values, key translation, or downstream business behavior.");
  return {
    entity: model.entity,
    schemaId: schema.schemaId,
    schemaName: schema.name,
    score,
    compatibleFieldCount,
    mappedFieldCount: mappedRows.length,
    configurationSaved,
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
