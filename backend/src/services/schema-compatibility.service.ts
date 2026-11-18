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
