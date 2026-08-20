import { Component, type ReactNode } from "react";
import { z } from "zod";
import type { ComponentCall, Message } from "@/state/store";
import type { Json, JsonObject } from "../../../server/contracts.ts";
import { ComponentCallSchema, UI_LIMITS } from "../../../server/ui/contract";
import { componentFallback } from "@/lib/ui/fallback";
import { ChecklistCard, type ChecklistItem } from "./checklist-card";
import { MetricsCard, type Metric } from "./metrics-card";
import { QuoteCard } from "./quote-card";
import { RecordCard, type RecordField } from "./record-card";
import { TodoistTasks } from "./todoist-tasks";
import { UiFrame } from "./frame";

class ComponentBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("[generative-ui] component renderer failed", this.props.name, error);
  }
  render() {
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
const JSON_OBJECT = z.record(z.string(), z.json());

function asObject(value: Json | undefined): JsonObject | null {
  const parsed = JSON_OBJECT.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stringOf(value: Json | undefined, maxLength: number = UI_LIMITS.value): string | undefined {
  const parsed = STRING.max(maxLength).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function boundedRecordFields(value: Json | undefined): RecordField[] {
  if (!Array.isArray(value)) return [];
  const fields: RecordField[] = [];
  for (const entry of value.slice(0, UI_LIMITS.recordRows)) {
    const object = asObject(entry);
    if (!object) continue;
    const label = stringOf(object.label, UI_LIMITS.label);
    const fieldValue = stringOf(object.value);
    if (label && fieldValue !== undefined) fields.push({ label, value: fieldValue });
  }
  return fields;
}

export function boundedMetrics(value: Json | undefined): Metric[] {
  if (!Array.isArray(value)) return [];
  const metrics: Metric[] = [];
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
        changeTone: stringOf(object.changeTone, UI_LIMITS.label),
      });
    }
  }
  return metrics;
}

export function boundedChecklistItems(value: Json | undefined): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (const entry of value.slice(0, UI_LIMITS.checklistRows)) {
    const object = asObject(entry);
    if (!object) continue;
    const text = stringOf(object.text, UI_LIMITS.content);
    if (!text) continue;
    items.push({ text, done: object.done === true, note: stringOf(object.note, UI_LIMITS.subtitle) });
  }
  return items;
}

function GalleryBody({ call, threadId }: { call: ComponentCall; threadId: string }) {
  const args = call.arguments;
  switch (call.name) {
    case "show_record_card":
      return (
        <RecordCard
          title={stringOf(args.title, UI_LIMITS.title)}
          subtitle={stringOf(args.subtitle, UI_LIMITS.subtitle)}
          status={stringOf(args.status, UI_LIMITS.label)}
          statusTone={stringOf(args.statusTone, UI_LIMITS.label)}
          fields={boundedRecordFields(args.fields)}
        />
      );
    case "show_metrics_card":
      return <MetricsCard title={stringOf(args.title, UI_LIMITS.title)} caption={stringOf(args.caption, UI_LIMITS.subtitle)} metrics={boundedMetrics(args.metrics)} />;
    case "show_checklist":
      return <ChecklistCard title={stringOf(args.title, UI_LIMITS.title)} caption={stringOf(args.caption, UI_LIMITS.subtitle)} items={boundedChecklistItems(args.items)} />;
    case "show_quote":
      return <QuoteCard quote={stringOf(args.quote)} attribution={stringOf(args.attribution, UI_LIMITS.subtitle)} context={stringOf(args.context, UI_LIMITS.subtitle)} />;
    case "show_todoist_tasks":
      return <TodoistTasks call={call} threadId={threadId} />;
    default: {
      const fallback = componentFallback(call.name, "This build does not know how to draw that component.");
      return (
        <UiFrame title={fallback.title}>
          <p className="text-[13px] text-ink-secondary">{fallback.body}</p>
        </UiFrame>
      );
    }
  }
}

function SafeComponentBody({ raw, threadId }: { raw: ComponentCall; threadId: string }) {
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
  return <GalleryBody call={call} threadId={threadId} />;
}

export function ComponentRenderer({ message, threadId }: { message: Message; threadId: string }) {
  const call = message.component;
  if (!call) return null;
  return (
    <ComponentBoundary name={call.name || "component"}>
      <SafeComponentBody raw={call} threadId={threadId} />
    </ComponentBoundary>
  );
}
