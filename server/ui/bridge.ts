import { z } from "zod";

import { UI_LIMITS } from "./contract.ts";
import {
  ConversationBubbleSchema,
  EventBlockerSchema,
  StatusRowSchema,
} from "./schemas.ts";

const ID = z.string().trim().min(1).max(UI_LIMITS.providerIdentity);
const LABEL = z.string().trim().min(1).max(UI_LIMITS.title);
const CONTENT = z.string().trim().min(1).max(UI_LIMITS.content);
const TIMESTAMP = z.string().trim().min(1).max(UI_LIMITS.providerIdentity);
const COMMON = {
  version: z.literal(1),
  deliveryId: ID,
  checkedAt: TIMESTAMP,
  changedKeys: z.array(ID).max(UI_LIMITS.bridgeItems),
  summary: CONTENT.optional(),
};

type BridgeEnvelope = {
  version: 1;
  deliveryId: string;
  checkedAt: string;
  changedKeys: string[];
  summary?: string;
};

function enforceBridgeBytes(value: BridgeEnvelope, context: z.RefinementCtx): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > UI_LIMITS.bridgePayloadBytes) {
    context.addIssue({
      code: "custom",
      message: `structured bridge payload exceeds ${UI_LIMITS.bridgePayloadBytes} serialized bytes`,
    });
  }
}

export const OpsBridgePayloadSchema = z.object({
  ...COMMON,
  kind: z.literal("ops_status"),
  source: z.literal("ops-watch"),
  standingOpenCount: z.number().int().min(0).max(100_000),
  previousOpenCount: z.number().int().min(0).max(100_000).optional(),
  findings: z.array(StatusRowSchema.extend({
    group: z.enum(["resolved", "new", "awaiting", "still_open", "healthy"]),
  }).strict()).max(UI_LIMITS.bridgeItems),
  quietState: z.object({ label: LABEL, detail: CONTENT.optional() }).strict().optional(),
}).strict().superRefine(enforceBridgeBytes);

export const OwedConversationSchema = z.object({
  id: ID,
  contact: LABEL,
  surface: z.enum(["imessage", "whatsapp", "instagram", "slack", "email", "sms", "other"]),
  age: z.string().trim().min(1).max(UI_LIMITS.label),
  stakes: z.enum(["low", "medium", "high", "critical"]),
  owner: z.string().trim().min(1).max(UI_LIMITS.label),
  owedReason: CONTENT,
  bubbles: z.array(ConversationBubbleSchema).min(1).max(16),
  draft: z.object({
    body: z.string().trim().min(1).max(8_000),
    status: z.enum(["draft", "needs_edit", "ready_to_mint"]),
  }).strict(),
  nextMove: CONTENT,
}).strict();

export const OwedBridgePayloadSchema = z.object({
  ...COMMON,
  kind: z.literal("owed_conversations"),
  source: z.literal("inbox-closer"),
  standingOpenCount: z.number().int().min(0).max(100_000),
  conversations: z.array(OwedConversationSchema).max(UI_LIMITS.bridgeItems),
  coverageGaps: z.array(CONTENT).max(20).optional(),
}).strict().superRefine(enforceBridgeBytes);

export const EventPortfolioItemSchema = z.object({
  eventId: ID,
  slug: ID,
  title: LABEL,
  doorsAt: TIMESTAMP,
  timeZone: z.string().trim().min(1).max(UI_LIMITS.label),
  owner: z.string().trim().min(1).max(UI_LIMITS.label).optional(),
  health: z.enum(["healthy", "watch", "at_risk", "critical"]),
  blockers: z.array(EventBlockerSchema).max(UI_LIMITS.bridgeItems),
  draftReadyLinks: z.array(z.object({
    id: ID,
    label: z.string().trim().min(1).max(UI_LIMITS.label),
    url: z.string().url().max(UI_LIMITS.value),
  }).strict()).max(12),
  nextMove: CONTENT,
}).strict();

export const EventBridgePayloadSchema = z.object({
  ...COMMON,
  kind: z.literal("event_portfolio"),
  source: z.literal("event-watch:coordinator"),
  standingOpenCount: z.number().int().min(0).max(100_000),
  events: z.array(EventPortfolioItemSchema).max(UI_LIMITS.bridgeItems),
}).strict().superRefine(enforceBridgeBytes);

export const StructuredBridgePayloadSchema = z.discriminatedUnion("kind", [
  OpsBridgePayloadSchema,
  OwedBridgePayloadSchema,
  EventBridgePayloadSchema,
]);

export type OpsBridgePayload = z.infer<typeof OpsBridgePayloadSchema>;
export type OwedBridgePayload = z.infer<typeof OwedBridgePayloadSchema>;
export type EventBridgePayload = z.infer<typeof EventBridgePayloadSchema>;
export type StructuredBridgePayload = z.infer<typeof StructuredBridgePayloadSchema>;

export function structuredBridgePrimer(payload: StructuredBridgePayload): string {
  return [
    "The following authenticated bridge payload contains authoritative typed facts. Do not re-parse a prose summary to recover counts, ids, timestamps, owners, statuses, or exact draft text.",
    "Use model judgment for relevance, prioritization, grouping, explanation, component composition, and the best next step.",
    JSON.stringify(payload),
  ].join("\n\n");
}
