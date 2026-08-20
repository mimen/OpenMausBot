import { Component, type ReactNode } from "react";
import { z } from "zod";
import type { ComponentCall, Message } from "@/state/store";
import type { Json, JsonObject } from "../../../server/contracts.ts";
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
          <p className="text-[13px] text-danger">{fallback.body}</p>
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

function stringOf(value: Json | undefined): string | undefined {
  const parsed = STRING.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function recordFields(value: Json | undefined): RecordField[] {
  if (!Array.isArray(value)) return [];
  const fields: RecordField[] = [];
  for (const entry of value) {
    const object = asObject(entry);
    if (!object) continue;
    const label = stringOf(object.label);
    const fieldValue = stringOf(object.value);
    if (label && fieldValue !== undefined) fields.push({ label, value: fieldValue });
  }
  return fields;
}

function metricsOf(value: Json | undefined): Metric[] {
  if (!Array.isArray(value)) return [];
  const metrics: Metric[] = [];
  for (const entry of value) {
    const object = asObject(entry);
    if (!object) continue;
    const label = stringOf(object.label);
    const metricValue = stringOf(object.value);
    if (label && metricValue !== undefined) {
      metrics.push({ label, value: metricValue, change: stringOf(object.change), changeTone: stringOf(object.changeTone) });
    }
  }
  return metrics;
}

function checklistItems(value: Json | undefined): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (const entry of value) {
    const object = asObject(entry);
    if (!object) continue;
    const text = stringOf(object.text);
    if (!text) continue;
    items.push({ text, done: object.done === true, note: stringOf(object.note) });
  }
  return items;
}

function GalleryBody({ call, threadId }: { call: ComponentCall; threadId: string }) {
  const args = call.arguments;
  switch (call.name) {
    case "show_record_card":
      return (
        <RecordCard
          title={stringOf(args.title)}
          subtitle={stringOf(args.subtitle)}
          status={stringOf(args.status)}
          statusTone={stringOf(args.statusTone)}
          fields={recordFields(args.fields)}
        />
      );
    case "show_metrics_card":
      return <MetricsCard title={stringOf(args.title)} caption={stringOf(args.caption)} metrics={metricsOf(args.metrics)} />;
    case "show_checklist":
      return <ChecklistCard title={stringOf(args.title)} caption={stringOf(args.caption)} items={checklistItems(args.items)} />;
    case "show_quote":
      return <QuoteCard quote={stringOf(args.quote)} attribution={stringOf(args.attribution)} context={stringOf(args.context)} />;
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

export function ComponentRenderer({ message, threadId }: { message: Message; threadId: string }) {
  const call = message.component;
  if (!call) return null;
  if (call.status === "error") {
    return (
      <UiFrame title={call.name}>
        <p className="text-[13px] text-danger">{call.result}</p>
      </UiFrame>
    );
  }
  return (
    <ComponentBoundary name={call.name}>
      <GalleryBody call={call} threadId={threadId} />
    </ComponentBoundary>
  );
}
