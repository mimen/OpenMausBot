import { z } from "zod";

import type { Json, JsonObject } from "../contracts.ts";

export type { Json, JsonObject };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ComponentKind = "card" | "list" | "action";
export type ComponentCallStatus = "shown" | "error";
export type ToolCallStatus = "pending" | "complete" | "error";

export type JsonSchema = {
  type?: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  properties?: { [key: string]: JsonSchema };
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
};

export type GallerySpec = {
  name: string;
  title: string;
  kind: ComponentKind;
  description: string;
  parameters: JsonSchema;
  confirmation: string;
};

export type TodoistTaskView = {
  id: string;
  content: string;
  isCompleted: boolean;
  url: string | null;
  due: string | null;
  unavailable?: boolean;
};

export type ComponentCall = {
  callId: string;
  name: string;
  arguments: JsonObject;
  result: string;
  status: ComponentCallStatus;
  actionToken: string;
};

const JSON_OBJECT = z.record(z.string(), z.json());

export function isJsonObject(value: Json): value is JsonObject {
  return JSON_OBJECT.safeParse(value).success;
}

export function asJsonObject(value: { [key: string]: Json }): JsonObject {
  return value;
}
