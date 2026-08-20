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
  actionPublicBytes: 16 * 1024,
  actionDeliveries: 24,
  bridgeItems: 100,
  depth: 12,
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
  validate: (value: Json) => Result<JsonObject, string>;
};

export type TodoistTaskView = {
  id: string;
  content: string;
  description?: string | null;
  isCompleted: boolean;
  url: string | null;
  due: string | null;
  recurring?: boolean;
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

function isPlainJsonObject(value: Json): value is JsonObject {
  return value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

export function jsonWithinBounds(value: Json, maxBytes: number, maxDepth = UI_LIMITS.depth): boolean {
  const encoder = new TextEncoder();
  const stack: Array<{ value: Json; depth: number }> = [{ value, depth: 0 }];
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > maxDepth) return false;
    if (current.value === null) {
      bytes += 4;
    } else if (Array.isArray(current.value)) {
      bytes += 2 + Math.max(0, current.value.length - 1);
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (isPlainJsonObject(current.value)) {
      bytes += 2 + Math.max(0, Object.keys(current.value).length - 1);
      for (const [key, item] of Object.entries(current.value)) {
        bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
        stack.push({ value: item, depth: current.depth + 1 });
      }
    } else {
      const stringValue = z.string().safeParse(current.value);
      if (stringValue.success) {
        bytes += encoder.encode(JSON.stringify(stringValue.data)).byteLength;
      } else {
        const numberValue = z.number().finite().safeParse(current.value);
        if (numberValue.success) bytes += String(numberValue.data).length;
        else bytes += current.value ? 4 : 5;
      }
    }
    if (bytes > maxBytes) return false;
  }
  return true;
}

export const BoundedJsonObjectSchema = z.custom<JsonObject>()
  .refine((value) => isPlainJsonObject(value), {
    message: "value must be a JSON object",
  })
  .refine((value) => jsonWithinBounds(value, UI_LIMITS.argumentsBytes), {
    message: `component arguments exceed ${UI_LIMITS.argumentsBytes} bytes or ${UI_LIMITS.depth} levels`,
  });

const BOUNDED_ARGUMENTS = BoundedJsonObjectSchema;

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

const BOUNDED_PUBLIC_OBJECT = JSON_OBJECT.refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= UI_LIMITS.actionPublicBytes,
  { message: `public action data exceeds ${UI_LIMITS.actionPublicBytes} bytes` },
);

export const ComponentActionDeliverySchema = z.object({
  deliveredAt: z.string().min(1).max(UI_LIMITS.providerIdentity),
  turnId: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
}).strict();

export const ComponentActionEventSchema = z.object({
  actionId: z.string().min(1).max(UI_LIMITS.callId),
  idempotencyKey: z.string().min(1).max(UI_LIMITS.value),
  threadId: z.string().min(1).max(UI_LIMITS.callId),
  callId: z.string().min(1).max(UI_LIMITS.callId),
  botId: z.string().min(1).max(UI_LIMITS.callId).optional(),
  componentName: z.string().min(1).max(UI_LIMITS.name),
  actionName: z.string().min(1).max(UI_LIMITS.name),
  entity: BOUNDED_PUBLIC_OBJECT,
  result: BOUNDED_PUBLIC_OBJECT,
  status: z.enum(["started", "succeeded", "failed"]),
  trustedOrigin: z.enum(["electron_main", "same_origin_browser", "recovery"]),
  createdAt: z.string().min(1).max(UI_LIMITS.providerIdentity),
  updatedAt: z.string().min(1).max(UI_LIMITS.providerIdentity),
  deliveryCursors: z.record(z.string().min(1).max(UI_LIMITS.providerIdentity), ComponentActionDeliverySchema)
    .refine((value) => Object.keys(value).length <= UI_LIMITS.actionDeliveries, {
      message: `action event has more than ${UI_LIMITS.actionDeliveries} delivery cursors`,
    }),
  execution: z.object({
    attempt: z.number().int().min(0).max(1_000),
    leaseUntil: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
  }).strict(),
  followUp: z.object({
    status: z.enum(["pending", "claimed", "dispatched", "failed"]),
    attempt: z.number().int().min(0).max(3),
    claimedUntil: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
    dispatchedAt: z.string().min(1).max(UI_LIMITS.providerIdentity).optional(),
    error: z.string().max(UI_LIMITS.result).optional(),
  }).strict(),
}).strict();

export type ComponentActionEvent = z.infer<typeof ComponentActionEventSchema>;

export function parseStoredComponentActionEvent(value: Json): Result<ComponentActionEvent, string> {
  try {
    const parsed = ComponentActionEventSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: "Stored component action data is malformed." };
  } catch {
    return { ok: false, error: "Stored component action data is malformed." };
  }
}

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
