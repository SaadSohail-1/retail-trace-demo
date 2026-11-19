import type { SchemaField } from "../services/api";

export interface ImportedSchemaDefinition {
  name: string;
  fields: SchemaField[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: JsonObject, allowed: ReadonlySet<string>, path: string): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw new Error(`${path}: unsupported JSON Schema keyword(s): ${unsupported.join(", ")}.`);
  }
}

function validateConstraint(key: string, value: unknown, type: string, path: string): void {
  if (key === "enum") {
    const matchesType = (item: unknown) => {
      if (type === "string" || type === "date") return typeof item === "string";
      if (type === "boolean") return typeof item === "boolean";
      return typeof item === "number" && Number.isFinite(item) && (type !== "integer" || Number.isInteger(item));
    };
    if (!Array.isArray(value) || value.some((item) => !matchesType(item))) {
      throw new Error(`${path}.enum must contain values of type '${type}'.`);
    }
    return;
  }
  if (key === "format") {
    if (type !== "string" || (value !== "date" && value !== "date-time")) {
      throw new Error(`${path}.format '${String(value)}' is unsupported; only date and date-time are supported.`);
    }
    return;
  }
  if (key === "pattern") {
    if (typeof value !== "string") throw new Error(`${path}.pattern must be a string.`);
    try { new RegExp(value); } catch { throw new Error(`${path}.pattern must be a valid regular expression.`); }
    return;
  }
  if (type === "string") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(`${path}.${key} must be a non-negative integer.`);
    }
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || (key === "multipleOf" && value <= 0) || (type === "integer" && !Number.isInteger(value))) {
    throw new Error(`${path}.${key} must be a valid ${type} constraint.`);
  }
}

function importNative(input: JsonObject): ImportedSchemaDefinition {
  onlyKeys(input, new Set(["name", "fields"]), "RetailTrace schema");
  if (typeof input.name !== "string" || !Array.isArray(input.fields)) {
    throw new Error('Expected native RetailTrace format: { "name": "...", "fields": [...] }.');
  }
  return { name: input.name, fields: input.fields as SchemaField[] };
}

export function importSchemaDefinition(input: unknown): ImportedSchemaDefinition {
  if (!isObject(input)) throw new Error("The uploaded file must contain a JSON object.");
  if ("name" in input || "fields" in input) return importNative(input);

  onlyKeys(input, new Set(["$schema", "title", "type", "properties", "required", "additionalProperties"]), "JSON Schema");
  if (input.type !== "object" || !isObject(input.properties) || Object.keys(input.properties).length === 0) {
    throw new Error("JSON Schema must describe an object with at least one property.");
  }
  const properties = input.properties;
  if (input.additionalProperties !== undefined && input.additionalProperties !== false) {
    throw new Error("JSON Schema additionalProperties must be false or omitted.");
  }
  if (input.required !== undefined && (!Array.isArray(input.required) || input.required.some((name) => typeof name !== "string"))) {
    throw new Error("JSON Schema required must be an array of property names.");
  }
  const required = new Set(input.required as string[] | undefined);
  const fields = Object.entries(properties).map(([name, raw]) => {
    const path = `properties.${name}`;
    if (!name.trim()) throw new Error(`${path}: field names cannot be empty.`);
    if (!isObject(raw) || typeof raw.type !== "string") throw new Error(`${path}.type is required and must be a supported primitive type.`);
    const sourceType = raw.type;
    if (!["string", "number", "integer", "boolean"].includes(sourceType)) {
      throw new Error(`${path}.type '${sourceType}' is unsupported. RetailTrace supports string, number, integer, boolean, date, and reference fields.`);
    }
    const constraintsAllowed = sourceType === "string"
      ? new Set(["minLength", "maxLength", "pattern", "format", "enum"])
      : sourceType === "number" || sourceType === "integer"
        ? new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "enum"])
        : new Set(["enum"]);
    onlyKeys(raw, new Set(["type", "title", "description", ...constraintsAllowed]), path);
    if (raw.format === "date" || raw.format === "date-time") {
      const unsupportedDateConstraints = Object.keys(raw).filter((key) => !["type", "title", "description", "format"].includes(key));
      if (unsupportedDateConstraints.length) {
        throw new Error(`${path}: RetailTrace date fields do not support constraint(s): ${unsupportedDateConstraints.join(", ")}.`);
      }
    }
    if (raw.title !== undefined && typeof raw.title !== "string") throw new Error(`${path}.title must be a string.`);
    if (raw.description !== undefined && typeof raw.description !== "string") throw new Error(`${path}.description must be a string.`);
    const constraints: Record<string, unknown> = {};
    let type: SchemaField["type"] = sourceType as SchemaField["type"];
    for (const [key, value] of Object.entries(raw)) {
      if (key === "type" || key === "title" || key === "description") continue;
      validateConstraint(key, value, sourceType, path);
      if (key === "format") {
        type = "date";
        constraints.format = value;
      } else {
        constraints[key] = value;
      }
    }
    return {
      name,
      type,
      required: required.has(name),
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      ...(Object.keys(constraints).length ? { constraints } : {}),
    } as SchemaField;
  });
  const unknownRequired = [...required].filter((name) => !(name in properties));
  if (unknownRequired.length) throw new Error(`required contains unknown property name(s): ${unknownRequired.join(", ")}.`);
  if (input.title !== undefined && typeof input.title !== "string") throw new Error("JSON Schema title must be a string.");
  return { name: typeof input.title === "string" ? input.title : "", fields };
}
