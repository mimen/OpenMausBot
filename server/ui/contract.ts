import { z } from "zod";

import type { Json, JsonObject } from "../contracts.ts";

export type { Json, JsonObject };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ComponentKind = "card" | "list" | "action";
export type ComponentCallStatus = "shown" | "error";
export type ToolCallStatus = "pending" | "complete" | "error";

export const UI_LIMITS = {
  callId: 200,
  name: 80,
  title: 200,
  subtitle: 400,
  label: 120,
  value: 2_000,
  content: 2_000,
  result: 2_000,
  providerIdentity: 200,
  recordRows: 50,
  checklistRows: 100,
  todoistRows: 25,
  metricsRows: 6,
  argumentsBytes: 128 * 1024,
} as const;

export type JsonSchema = {
  type?: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  properties?: { [key: string]: JsonSchema };
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
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
  description?: string | null;
  isCompleted: boolean;
  url: string | null;
  due: string | null;
  projectId?: string | null;
  projectName?: string | null;
  labels?: string[];
  commentCount?: number;
  unavailable?: boolean;
};

export const ComponentOriginSchema = z.object({
  provider: z.string().min(1).max(UI_LIMITS.providerIdentity),
  providerInstanceId: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
  turnId: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
  itemId: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
  providerCallId: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
}).strict();

export type ComponentOrigin = z.infer<typeof ComponentOriginSchema>;

const JSON_OBJECT = z.record(z.string(), z.json());
const BOUNDED_ARGUMENTS = JSON_OBJECT.refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= UI_LIMITS.argumentsBytes,
  { message: `component arguments exceed ${UI_LIMITS.argumentsBytes} bytes` },
);

/** Public, persisted component transcript shape. It deliberately carries no
 * completion credential: renderer clicks cross Electron IPC, while transcripts
 * remain safe to expose through SQLite and /api/bots. */
export const ComponentCallSchema = z.object({
  callId: z.string().min(1).max(UI_LIMITS.callId),
  name: z.string().min(1).max(UI_LIMITS.name),
  arguments: BOUNDED_ARGUMENTS,
  result: z.string().max(UI_LIMITS.result),
  status: z.enum(["shown", "error"]),
  origin: ComponentOriginSchema,
}).strict();

/** Read-only migration schema for the first generative-UI build. The legacy
 * actionToken is accepted only long enough to remove it from the SQLite row. */
const LegacyComponentCallSchema = ComponentCallSchema.omit({ origin: true }).extend({
  actionToken: z.string().optional(),
  origin: ComponentOriginSchema.optional(),
}).strict();

export type ComponentCall = z.infer<typeof ComponentCallSchema>;

export function parseStoredComponentCall(value: Json | undefined): Result<{ call: ComponentCall; migrated: boolean }, string> {
  try {
    const current = ComponentCallSchema.safeParse(value);
    if (current.success) return { ok: true, value: { call: current.data, migrated: false } };
    const legacy = LegacyComponentCallSchema.safeParse(value);
    if (!legacy.success) return { ok: false, error: "Stored component data is malformed." };
    const { actionToken: _discarded, origin, ...rest } = legacy.data;
    return {
      ok: true,
      value: {
        call: {
          ...rest,
          origin: origin ?? { provider: "legacy" },
        },
        migrated: true,
      },
    };
  } catch {
    return { ok: false, error: "Stored component data is malformed." };
  }
}

export function invalidStoredComponentCall(messageId: string): ComponentCall {
  return {
    callId: `invalid-${messageId}`.slice(0, UI_LIMITS.callId),
    name: "Stored component",
    arguments: {},
    result: "This stored component could not be read safely.",
    status: "error",
    origin: { provider: "quarantine" },
  };
}

export function isJsonObject(value: Json): value is JsonObject {
  return JSON_OBJECT.safeParse(value).success;
}

export function asJsonObject(value: { [key: string]: Json }): JsonObject {
  return value;
}
