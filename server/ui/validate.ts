import { z } from "zod";

import type { Json, JsonObject, JsonSchema, Result } from "./contract.ts";
import { UI_LIMITS } from "./contract.ts";

const STRING = z.string();
const NUMBER = z.number().finite();
const BOOLEAN = z.boolean();

function isShallowJsonObject(value: Json): value is JsonObject {
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== "[object Object]") return false;
  // SAFETY: Json excludes functions and undefined; the checks above exclude every non-object union member.
  return true;
}

export function validateArgs(schema: JsonSchema, value: Json): Result<JsonObject, string> {
  const checked = check(schema, value, "arguments", 0);
  if (!checked.ok) return checked;
  if (!isShallowJsonObject(checked.value)) return { ok: false, error: "arguments must be an object" };
  return { ok: true, value: checked.value };
}

function check(schema: JsonSchema, value: Json, path: string, depth: number): Result<Json, string> {
  if (depth > UI_LIMITS.depth) return { ok: false, error: `${path} exceeds the maximum nesting depth of ${UI_LIMITS.depth}` };
  if (schema.type === "string") {
    const parsed = STRING.safeParse(value);
    if (!parsed.success) return { ok: false, error: `${path} must be a string` };
    if (schema.minLength !== undefined && parsed.data.length < schema.minLength) {
      return { ok: false, error: `${path} has at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}` };
    }
    if (schema.maxLength !== undefined && parsed.data.length > schema.maxLength) {
      return { ok: false, error: `${path} has at most ${schema.maxLength} characters` };
    }
    if (schema.enum && !schema.enum.includes(parsed.data)) {
      return { ok: false, error: `${path} must be one of ${schema.enum.join(", ")}` };
    }
    return { ok: true, value: parsed.data };
  }
  if (schema.type === "number") {
    const parsed = NUMBER.safeParse(value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `${path} must be a number` };
  }
  if (schema.type === "boolean") {
    const parsed = BOOLEAN.safeParse(value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `${path} must be a boolean` };
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return { ok: false, error: `${path} must be an array` };
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return { ok: false, error: `${path} has at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}` };
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return { ok: false, error: `${path} has at most ${schema.maxItems} items` };
    }
    const items: Json[] = [];
    for (let i = 0; i < value.length; i++) {
      const itemSchema = schema.items ?? {};
      const next = check(itemSchema, value[i], `${path}[${i}]`, depth + 1);
      if (!next.ok) return next;
      items.push(next.value);
    }
    return { ok: true, value: items };
  }

  if (schema.type === "object" || schema.properties || schema.required) {
    if (!isShallowJsonObject(value)) return { ok: false, error: `${path} must be an object` };
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) return { ok: false, error: `${path}.${key} is required` };
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) return { ok: false, error: `${path}.${key} is not allowed` };
      }
    }
    const out: { [key: string]: Json } = {};
    for (const [key, raw] of Object.entries(value)) {
      const property = properties[key];
      if (!property) {
        out[key] = raw;
        continue;
      }
      const next = check(property, raw, `${path}.${key}`, depth + 1);
      if (!next.ok) return next;
      out[key] = next.value;
    }
    return { ok: true, value: out };
  }

  return { ok: true, value };
}
