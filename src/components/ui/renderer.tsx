import {
  openMausChecklistBinding,
  openMausMetricsBinding,
  openMausQuoteBinding,
  openMausRecordBinding,
} from "@mimen/generative-ui-pack/openmaus";
import {
  Checklist as SharedChecklist,
  Metrics as SharedMetrics,
  Quote as SharedQuote,
  Record as SharedRecord,
  type ChecklistProps,
  type MetricsProps,
  type RecordProps,
} from "@mimen/generative-ui-pack/react";
import { Component, type ComponentType, type ReactNode } from "react";
import { z } from "zod";

import { componentFallback } from "@/lib/ui/fallback";
import type { ComponentCall, Message } from "@/state/store";
import type { Json, JsonObject } from "../../../server/contracts.ts";
import { ComponentCallSchema, UI_LIMITS } from "../../../server/ui/contract.ts";
import { componentVersionForToolName, type ComponentVersion } from "../../../server/ui/read-only-components.ts";
import {
  BookingSlotSchema,
  ConversationSchema,
  EventCountdownSchema,
  StatusBoardSchema,
  SupplementStackSchema,
  SupplyStatusSchema,
  WeekCalendarSchema,
} from "../../../server/ui/schemas.ts";
import { BookingSlot } from "./booking-slot";
import { Conversation } from "./conversation";
import { EventCountdown } from "./event-countdown";
import { StatusBoard } from "./status-board";
import { SupplementStack } from "./supplement-stack";
import { SupplyStatus } from "./supply-status";
import { TodoistTasks } from "./todoist-tasks";
import { UiFrame } from "./frame";
import { WeekCalendar } from "./week-calendar";

class ComponentBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    console.error("[generative-ui] component renderer failed", this.props.name, error);
  }
  render(): ReactNode {
    if (this.state.failed) {
      const fallback = componentFallback(this.props.name, "This component failed to draw. The rest of the chat is unaffected.");
      return (
        <UiFrame title={fallback.title}>
          <p className="text-[13px] text-danger" role="alert">{fallback.body}</p>
        </UiFrame>
      );
    }
    return this.props.children;
  }
}

const STRING = z.string();
const TONE = z.enum(["neutral", "positive", "caution", "negative"]);
const JSON_OBJECT = z.record(z.string(), z.json());

function asObject(value: Json | undefined): JsonObject | null {
  const parsed = JSON_OBJECT.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stringOf(value: Json | undefined, maxLength: number = UI_LIMITS.value): string | undefined {
  const parsed = STRING.max(maxLength).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function toneOf(value: Json | undefined): RecordProps["statusTone"] {
  const parsed = TONE.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function boundedRecordFields(value: Json | undefined): RecordProps["fields"] {
  if (!Array.isArray(value)) return [];
  const fields: Array<RecordProps["fields"][number]> = [];
  for (const entry of value.slice(0, UI_LIMITS.recordRows)) {
    const object = asObject(entry);
    if (!object) continue;
    const label = stringOf(object.label, UI_LIMITS.label);
    const fieldValue = stringOf(object.value);
    if (label && fieldValue !== undefined) fields.push({ label, value: fieldValue });
  }
  return fields;
}

export function boundedMetrics(value: Json | undefined): MetricsProps["metrics"] {
  if (!Array.isArray(value)) return [];
  const metrics: Array<MetricsProps["metrics"][number]> = [];
  for (const entry of value.slice(0, UI_LIMITS.metricsRows)) {
    const object = asObject(entry);
    if (!object) continue;
    const label = stringOf(object.label, UI_LIMITS.label);
    const metricValue = stringOf(object.value);
    if (label && metricValue !== undefined) {
      metrics.push({
        label,
        value: metricValue,
        change: stringOf(object.change, UI_LIMITS.subtitle),
        changeTone: toneOf(object.changeTone),
      });
    }
  }
  return metrics;
}

export function boundedChecklistItems(value: Json | undefined): ChecklistProps["items"] {
  if (!Array.isArray(value)) return [];
  const items: Array<ChecklistProps["items"][number]> = [];
  for (const entry of value.slice(0, UI_LIMITS.checklistRows)) {
    const object = asObject(entry);
    if (!object) continue;
    const text = stringOf(object.text, UI_LIMITS.content);
    if (!text) continue;
    items.push({ text, done: object.done === true, note: stringOf(object.note, UI_LIMITS.subtitle) });
  }
  return items;
}

type RendererProps = { call: ComponentCall; threadId: string; readOnly: boolean };
type Renderer = ComponentType<RendererProps>;

function InvalidArguments({ name }: { name: string }) {
  return (
    <UiFrame title={name}>
      <p className="text-[13px] text-danger" role="alert">This component's arguments could not be read safely.</p>
    </UiFrame>
  );
}

function componentVersionKey(version: ComponentVersion): string {
  return `${version.componentId}@${version.viewVersion}`;
}

const SHARED_RENDERER_REGISTRY = {
  [componentVersionKey(openMausRecordBinding)]: ({ call, readOnly }: RendererProps) => {
    const parsed = openMausRecordBinding.viewSchema.safeParse({
      title: stringOf(call.arguments.title, UI_LIMITS.title),
      subtitle: stringOf(call.arguments.subtitle, UI_LIMITS.subtitle),
      status: stringOf(call.arguments.status, UI_LIMITS.label),
      statusTone: toneOf(call.arguments.statusTone),
      fields: boundedRecordFields(call.arguments.fields),
    });
    return parsed.success
      ? <SharedRecord {...parsed.data} mode={readOnly ? "preview" : "live"} />
      : <InvalidArguments name="Record" />;
  },
  [componentVersionKey(openMausMetricsBinding)]: ({ call, readOnly }: RendererProps) => {
    const parsed = openMausMetricsBinding.viewSchema.safeParse({
      title: stringOf(call.arguments.title, UI_LIMITS.title),
      caption: stringOf(call.arguments.caption, UI_LIMITS.subtitle),
      metrics: boundedMetrics(call.arguments.metrics),
    });
    return parsed.success
      ? <SharedMetrics {...parsed.data} mode={readOnly ? "preview" : "live"} />
      : <InvalidArguments name="Figures" />;
  },
  [componentVersionKey(openMausChecklistBinding)]: ({ call, readOnly }: RendererProps) => {
    const parsed = openMausChecklistBinding.viewSchema.safeParse({
      title: stringOf(call.arguments.title, UI_LIMITS.title),
      caption: stringOf(call.arguments.caption, UI_LIMITS.subtitle),
      items: boundedChecklistItems(call.arguments.items),
    });
    return parsed.success
      ? <SharedChecklist {...parsed.data} mode={readOnly ? "preview" : "live"} />
      : <InvalidArguments name="Checklist" />;
  },
  [componentVersionKey(openMausQuoteBinding)]: ({ call, readOnly }: RendererProps) => {
    const parsed = openMausQuoteBinding.viewSchema.safeParse({
      quote: stringOf(call.arguments.quote),
      attribution: stringOf(call.arguments.attribution, UI_LIMITS.subtitle),
      context: stringOf(call.arguments.context, UI_LIMITS.subtitle),
    });
    return parsed.success
      ? <SharedQuote {...parsed.data} mode={readOnly ? "preview" : "live"} />
      : <InvalidArguments name="Quotation" />;
  },
} satisfies Record<string, Renderer>;

const RENDERER_REGISTRY = {
  show_todoist_tasks: ({ call, threadId, readOnly }: RendererProps) => (
    <TodoistTasks call={call} readOnly={readOnly} threadId={threadId} />
  ),
  show_status_board: ({ call }: RendererProps) => {
    const parsed = StatusBoardSchema.safeParse(call.arguments);
    return parsed.success ? <StatusBoard data={parsed.data} /> : <InvalidArguments name="Status board" />;
  },
  show_supplement_stack: ({ call, threadId }: RendererProps) => {
    const parsed = SupplementStackSchema.safeParse(call.arguments);
    return parsed.success ? <SupplementStack call={call} data={parsed.data} threadId={threadId} /> : <InvalidArguments name="Supplement stack" />;
  },
  show_week_calendar: ({ call, threadId }: RendererProps) => {
    const parsed = WeekCalendarSchema.safeParse(call.arguments);
    return parsed.success ? <WeekCalendar data={parsed.data} threadId={threadId} /> : <InvalidArguments name="Week calendar" />;
  },
  show_supply_status: ({ call, threadId }: RendererProps) => {
    const parsed = SupplyStatusSchema.safeParse(call.arguments);
    return parsed.success ? <SupplyStatus data={parsed.data} threadId={threadId} /> : <InvalidArguments name="Supply status" />;
  },
  show_conversation: ({ call, threadId }: RendererProps) => {
    const parsed = ConversationSchema.safeParse(call.arguments);
    return parsed.success ? <Conversation data={parsed.data} threadId={threadId} /> : <InvalidArguments name="Conversation" />;
  },
  show_booking_slot: ({ call, threadId }: RendererProps) => {
    const parsed = BookingSlotSchema.safeParse(call.arguments);
    return parsed.success ? <BookingSlot data={parsed.data} threadId={threadId} /> : <InvalidArguments name="Booking slot" />;
  },
  show_event_countdown: ({ call }: RendererProps) => {
    const parsed = EventCountdownSchema.safeParse(call.arguments);
    return parsed.success ? <EventCountdown data={parsed.data} /> : <InvalidArguments name="Event countdown" />;
  },
} satisfies Record<string, Renderer>;

const SHARED_BINDINGS = [
  openMausRecordBinding,
  openMausMetricsBinding,
  openMausChecklistBinding,
  openMausQuoteBinding,
] as const;

export const RENDERER_NAMES: ReadonlySet<string> = new Set([
  ...SHARED_BINDINGS.map((binding) => binding.toolName),
  ...Object.keys(RENDERER_REGISTRY),
]);
const SHARED_RENDERER_BY_VERSION: ReadonlyMap<string, Renderer> = new Map(Object.entries(SHARED_RENDERER_REGISTRY));
const RENDERER_BY_NAME: ReadonlyMap<string, Renderer> = new Map(Object.entries(RENDERER_REGISTRY));

function storedComponentVersion(call: ComponentCall): ComponentVersion | undefined {
  if (call.componentId !== undefined && call.viewVersion !== undefined) {
    return { componentId: call.componentId, viewVersion: call.viewVersion };
  }
  return componentVersionForToolName(call.name);
}

function GalleryBody({ call, threadId, readOnly }: RendererProps) {
  const version = storedComponentVersion(call);
  if (version) {
    const SharedRenderer = SHARED_RENDERER_BY_VERSION.get(componentVersionKey(version));
    if (SharedRenderer) return <SharedRenderer call={call} readOnly={readOnly} threadId={threadId} />;
    return (
      <UiFrame title={call.name}>
        <p className="text-[13px] text-danger" role="alert">This stored component version is not supported by this build.</p>
      </UiFrame>
    );
  }
  const RendererComponent = RENDERER_BY_NAME.get(call.name);
  if (RendererComponent) return <RendererComponent call={call} readOnly={readOnly} threadId={threadId} />;
  const fallback = componentFallback(call.name, "This build does not know how to draw that component.");
  return (
    <UiFrame title={fallback.title}>
      <p className="text-[13px] text-ink-secondary">{fallback.body}</p>
    </UiFrame>
  );
}

function SafeComponentBody({ raw, threadId, readOnly }: { raw: ComponentCall; threadId: string; readOnly: boolean }) {
  const parsed = ComponentCallSchema.safeParse(raw);
  if (!parsed.success) {
    return (
      <UiFrame title="Stored component">
        <p className="text-[13px] text-danger" role="alert">This component could not be read safely.</p>
      </UiFrame>
    );
  }
  const call = parsed.data;
  if (call.status === "error") {
    return (
      <UiFrame title={call.name}>
        <p className="text-[13px] text-danger" role="alert">{call.result}</p>
      </UiFrame>
    );
  }
  return <GalleryBody call={call} readOnly={readOnly} threadId={threadId} />;
}

export function ComponentRenderer({
  message,
  threadId,
  readOnly = false,
}: {
  message: Message;
  threadId: string;
  readOnly?: boolean;
}) {
  const call = message.component;
  if (!call) return null;
  return (
    <ComponentBoundary name={call.name || "component"}>
      <SafeComponentBody raw={call} readOnly={readOnly} threadId={threadId} />
    </ComponentBoundary>
  );
}
