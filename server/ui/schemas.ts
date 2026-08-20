import { z } from "zod";

import { UI_LIMITS } from "./contract.ts";

const SHORT = z.string().trim().min(1).max(UI_LIMITS.label);
const TITLE = z.string().trim().min(1).max(UI_LIMITS.title);
const SUBTITLE = z.string().trim().min(1).max(UI_LIMITS.subtitle);
const CONTENT = z.string().trim().min(1).max(UI_LIMITS.content);
const IDENTIFIER = z.string().trim().min(1).max(UI_LIMITS.providerIdentity);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ISO_DATE_TIME = z.string().trim().max(UI_LIMITS.providerIdentity).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
);
const URL = z.string().url().max(UI_LIMITS.value);
const COUNT = z.number().int().min(0).max(100_000);
const SIGNED_COUNT = z.number().int().min(-100_000).max(100_000);
const AMOUNT = z.number().finite().min(0).max(1_000_000_000);

export const LoopFrameSchema = z.object({
  openCount: COUNT,
  delta: SIGNED_COUNT,
  source: SHORT,
  freshness: z.object({
    label: SHORT,
    checkedAt: ISO_DATE_TIME.optional(),
  }).strict(),
  owner: SHORT.optional(),
}).strict();

export const ReplyChoiceSchema = z.object({
  id: IDENTIFIER,
  label: SHORT,
  message: z.string().trim().min(1).max(UI_LIMITS.value),
  tone: z.enum(["neutral", "primary", "caution"]).optional(),
}).strict();

export const StatusSeveritySchema = z.enum(["healthy", "info", "warning", "serious", "critical"]);

export const StatusRowSchema = z.object({
  id: IDENTIFIER,
  label: TITLE,
  severity: StatusSeveritySchema,
  since: SHORT.optional(),
  owner: SHORT.optional(),
  evidence: CONTENT.optional(),
  nextMove: CONTENT.optional(),
  service: SHORT.optional(),
}).strict();

export const StatusGroupSchema = z.object({
  kind: z.enum(["resolved", "new", "awaiting", "still_open", "healthy"]),
  label: SHORT.optional(),
  rows: z.array(StatusRowSchema).max(40),
}).strict();

export const StatusBoardSchema = z.object({
  title: TITLE.default("Status board"),
  frame: LoopFrameSchema,
  summary: CONTENT.optional(),
  groups: z.array(StatusGroupSchema).min(1).max(5),
  quietState: z.object({
    label: TITLE,
    detail: SUBTITLE.optional(),
  }).strict().optional(),
}).strict();

export const SupplementItemSchema = z.object({
  id: IDENTIFIER,
  label: TITLE,
  dose: SHORT.optional(),
  note: SUBTITLE.optional(),
  situational: z.boolean().optional(),
  checked: z.boolean().optional(),
}).strict();

export const SupplementGroupSchema = z.object({
  period: z.enum(["am", "pm", "situational"]),
  label: SHORT.optional(),
  items: z.array(SupplementItemSchema).max(30),
}).strict();

export const SupplementStackSchema = z.object({
  title: TITLE.default("Supplement stack"),
  date: ISO_DATE,
  timeZone: SHORT,
  regimen: z.object({
    version: IDENTIFIER,
    snapshotAt: ISO_DATE_TIME,
    source: SHORT,
  }).strict(),
  groups: z.array(SupplementGroupSchema).min(1).max(3),
  replayLabel: SUBTITLE.optional(),
}).strict();

export const WeekChipSchema = z.object({
  id: IDENTIFIER,
  label: SHORT,
  kind: z.enum(["existing", "proposed", "conflict"]),
  time: SHORT.optional(),
  context: SUBTITLE.optional(),
}).strict();

export const WeekDaySchema = z.object({
  date: ISO_DATE,
  label: SHORT,
  chips: z.array(WeekChipSchema).max(16),
  fieldTrips: z.array(z.object({
    id: IDENTIFIER,
    label: SHORT,
    time: SHORT.optional(),
  }).strict()).max(6).optional(),
  walkers: z.array(z.object({
    id: IDENTIFIER,
    label: SHORT,
    assignment: SUBTITLE,
  }).strict()).max(8).optional(),
}).strict();

export const WeekCalendarSchema = z.object({
  title: TITLE.default("Week calendar"),
  frame: LoopFrameSchema.optional(),
  weekStart: ISO_DATE,
  timeZone: SHORT,
  days: z.array(WeekDaySchema).length(7),
  relevantContext: z.array(CONTENT).max(12).optional(),
  proposalExclusions: z.array(CONTENT).max(12).optional(),
  replies: z.array(ReplyChoiceSchema).max(8),
}).strict();

export const SupplyStatusSchema = z.object({
  title: TITLE.default("Supply status"),
  frame: LoopFrameSchema.optional(),
  recommendation: z.object({
    label: TITLE,
    detail: CONTENT.optional(),
    tone: z.enum(["positive", "caution", "negative", "neutral"]),
  }).strict(),
  gauge: z.object({
    filled: AMOUNT,
    incoming: AMOUNT,
    threshold: AMOUNT,
    capacity: AMOUNT,
    unit: SHORT,
  }).strict().superRefine((value, context) => {
    if (value.filled + value.incoming > value.capacity) {
      context.addIssue({ code: "custom", message: "filled plus incoming cannot exceed capacity" });
    }
    if (value.threshold > value.capacity) {
      context.addIssue({ code: "custom", message: "threshold cannot exceed capacity" });
    }
  }),
  bottles: z.object({
    onHand: COUNT,
    incoming: COUNT,
    total: COUNT,
  }).strict().superRefine((value, context) => {
    if (value.total !== value.onHand + value.incoming) {
      context.addIssue({ code: "custom", message: "bottle total must equal on-hand plus incoming" });
    }
  }),
  cost: z.object({
    amount: AMOUNT,
    currency: z.string().regex(/^[A-Z]{3}$/),
    label: SUBTITLE.optional(),
  }).strict().optional(),
  agingDeadline: z.object({
    at: ISO_DATE_TIME,
    label: SUBTITLE,
  }).strict().optional(),
  provenance: z.array(z.object({ label: SHORT, value: SUBTITLE.optional() }).strict()).max(10),
  replies: z.array(ReplyChoiceSchema).max(8),
}).strict();

export const ConversationBubbleSchema = z.object({
  id: IDENTIFIER,
  direction: z.enum(["inbound", "outbound"]),
  text: z.string().trim().min(1).max(UI_LIMITS.value),
  at: ISO_DATE_TIME,
}).strict();

export const ConversationSchema = z.object({
  title: TITLE,
  frame: LoopFrameSchema.optional(),
  surface: z.enum(["imessage", "whatsapp", "instagram", "slack", "email", "sms", "other"]),
  age: SHORT,
  stakes: z.enum(["low", "medium", "high", "critical"]),
  bubbles: z.array(ConversationBubbleSchema).min(1).max(16),
  owedReason: CONTENT,
  draft: z.object({
    body: z.string().trim().min(1).max(8_000),
    status: z.enum(["draft", "needs_edit", "ready_to_mint"]),
  }).strict(),
  replies: z.array(ReplyChoiceSchema).max(8),
}).strict();

export const BookingSlotSchema = z.object({
  title: TITLE.default("Booking slot"),
  frame: LoopFrameSchema.optional(),
  candidate: z.object({
    startsAt: ISO_DATE_TIME,
    endsAt: ISO_DATE_TIME,
    timeZone: SHORT,
    label: TITLE,
  }).strict().superRefine((value, context) => {
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      context.addIssue({ code: "custom", message: "booking slot must end after it starts" });
    }
  }),
  lastCutAge: SHORT,
  surroundingFit: z.array(z.object({
    id: IDENTIFIER,
    label: SHORT,
    timing: SHORT,
    relation: z.enum(["before", "after", "overlap", "buffer"]),
  }).strict()).max(12),
  square: z.object({
    status: z.literal("unverified"),
    label: SUBTITLE,
  }).strict(),
  replies: z.array(ReplyChoiceSchema).max(8),
}).strict();

export const EventBlockerSchema = z.object({
  id: IDENTIFIER,
  label: TITLE,
  status: z.enum(["completed", "open"]),
  owner: SHORT.optional(),
  evidence: CONTENT.optional(),
  nextMove: CONTENT.optional(),
}).strict();

export const EventCountdownSchema = z.object({
  title: TITLE,
  frame: LoopFrameSchema,
  doorsAt: ISO_DATE_TIME,
  timeZone: SHORT,
  blockers: z.array(EventBlockerSchema).max(50),
  draftReadyLinks: z.array(z.object({
    id: IDENTIFIER,
    label: SHORT,
    url: URL,
  }).strict()).max(12),
  nextMove: CONTENT,
}).strict();

export const COMPILED_COMPONENT_SCHEMAS = {
  show_status_board: StatusBoardSchema,
  show_supplement_stack: SupplementStackSchema,
  show_week_calendar: WeekCalendarSchema,
  show_supply_status: SupplyStatusSchema,
  show_conversation: ConversationSchema,
  show_booking_slot: BookingSlotSchema,
  show_event_countdown: EventCountdownSchema,
} as const;

export type CompiledComponentName = keyof typeof COMPILED_COMPONENT_SCHEMAS;
export type LoopFrame = z.infer<typeof LoopFrameSchema>;
export type ReplyChoice = z.infer<typeof ReplyChoiceSchema>;
export type StatusBoard = z.infer<typeof StatusBoardSchema>;
export type SupplementStack = z.infer<typeof SupplementStackSchema>;
export type WeekCalendar = z.infer<typeof WeekCalendarSchema>;
export type SupplyStatus = z.infer<typeof SupplyStatusSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type BookingSlot = z.infer<typeof BookingSlotSchema>;
export type EventCountdown = z.infer<typeof EventCountdownSchema>;
