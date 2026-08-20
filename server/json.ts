import { z } from "zod";

import type { Json, JsonObject } from "./contracts.ts";

const JSON_OBJECT = z.record(z.string(), z.json());
const TOOL_RESULT_PART = z.union([
  z.string(),
  z.object({ text: z.string() }).passthrough().transform((part) => part.text),
]);
const STRING = z.string();
const JSON_ARRAY = z.array(z.json());

export function parseJsonObject(value: Json | undefined): JsonObject | undefined {
  const parsed = JSON_OBJECT.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function stringifyJsonResult(...values: Array<Json | undefined>): string | undefined {
  const value = values.find((entry) => entry !== undefined && entry !== null);
  if (value === undefined || value === null) return undefined;
  const parsed = STRING.safeParse(value);
  return parsed.success ? parsed.data : JSON.stringify(value);
}

export function toolResultContentText(value: Json | undefined): string | undefined {
  const text = STRING.safeParse(value);
  if (text.success) return text.data;
  const array = JSON_ARRAY.safeParse(value);
  if (!array.success) return undefined;
  const parts: string[] = [];
  for (const entry of array.data) {
    const part = TOOL_RESULT_PART.safeParse(entry);
    if (part.success) parts.push(part.data);
  }
  return parts.length ? parts.join("\n") : undefined;
}
