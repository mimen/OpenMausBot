import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Info,
  LockKeyhole,
  Minus,
  OctagonAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { composeReplyChip } from "@/lib/ui/reply-chips";
import type { LoopFrame as LoopFrameData, ReplyChoice } from "../../../server/ui/schemas.ts";

export type { ReplyChoice };
export type RowTone = "healthy" | "info" | "warning" | "serious" | "critical" | "neutral";

const ROW_TONES = {
  healthy: "bg-success",
  info: "bg-accent",
  warning: "bg-warning",
  serious: "bg-danger/70",
  critical: "bg-danger",
  neutral: "bg-ink-secondary/45",
} satisfies Record<RowTone, string>;

export function LoopFrame({ frame }: { frame: LoopFrameData }) {
  const deltaLabel = frame.delta === 0
    ? "No change"
    : `${frame.delta > 0 ? "+" : ""}${frame.delta} since the last check`;
  return (
    <div className="grid gap-3 rounded-xl bg-inset/70 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <div className="flex items-baseline gap-2">
        <span className="text-[24px] font-semibold leading-none tabular-nums text-ink">{frame.openCount}</span>
        <span className="text-[12px] font-medium text-ink-secondary">open</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
            frame.delta > 0
              ? "bg-danger/15 text-danger"
              : frame.delta < 0
                ? "bg-success/15 text-success"
                : "border border-hairline/70 bg-raised text-ink-secondary",
          )}
          aria-label={deltaLabel}
        >
          {frame.delta > 0 ? <ArrowUp size={11} aria-hidden="true" /> : frame.delta < 0 ? <ArrowDown size={11} aria-hidden="true" /> : <Minus size={11} aria-hidden="true" />}
          {frame.delta === 0 ? "±0" : `${frame.delta > 0 ? "+" : ""}${frame.delta}`}
        </span>
      </div>
      <dl className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-secondary sm:justify-end">
        <div className="flex gap-1"><dt className="sr-only">Source</dt><dd className="truncate">{frame.source}</dd></div>
        <div className="flex gap-1"><dt className="sr-only">Freshness</dt><dd>{frame.freshness.label}</dd></div>
        {frame.owner ? <div className="flex gap-1"><dt className="sr-only">Owner</dt><dd>{frame.owner}</dd></div> : null}
      </dl>
    </div>
  );
}

export function GeneralRow({
  tone = "neutral",
  leading,
  title,
  detail,
  metadata,
  trailing,
  completed = false,
}: {
  tone?: RowTone;
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  metadata?: ReactNode;
  trailing?: ReactNode;
  completed?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4px_minmax(0,1fr)] gap-3 py-2.5 sm:grid-cols-[4px_minmax(0,1fr)_auto] sm:items-start">
      <span className={cn("row-span-2 h-full min-h-8 rounded-full sm:row-span-1", ROW_TONES[tone])} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2">
          {leading ? <span className="mt-0.5 shrink-0 text-ink-secondary">{leading}</span> : null}
          <div className="min-w-0">
            <div className={cn("text-[13.5px] font-medium leading-5 text-ink", completed && "text-ink-secondary")}>{title}</div>
            {detail ? <div className="mt-0.5 text-[12px] leading-5 text-ink-secondary [overflow-wrap:anywhere]">{detail}</div> : null}
            {metadata ? <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-secondary">{metadata}</div> : null}
          </div>
        </div>
      </div>
      {trailing ? <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">{trailing}</div> : null}
    </div>
  );
}

export function Gauge({
  filled,
  incoming,
  threshold,
  capacity,
  unit,
}: {
  filled: number;
  incoming: number;
  threshold: number;
  capacity: number;
  unit: string;
}) {
  const safeCapacity = Math.max(capacity, 1);
  const filledPercent = Math.min(100, Math.max(0, (filled / safeCapacity) * 100));
  const incomingPercent = Math.min(100 - filledPercent, Math.max(0, (incoming / safeCapacity) * 100));
  const thresholdPercent = Math.min(100, Math.max(0, (threshold / safeCapacity) * 100));
  const label = `${filled} ${unit} filled, ${incoming} ${unit} incoming, threshold ${threshold} of ${capacity} ${unit}`;
  return (
    <div role="img" aria-label={label} className="rounded-xl bg-inset/70 p-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-raised">
        <div className="absolute inset-y-0 start-0 bg-accent" style={{ width: `${filledPercent}%` }} />
        <div className="absolute inset-y-0 bg-accent/35" style={{ insetInlineStart: `${filledPercent}%`, width: `${incomingPercent}%` }} />
        <div className="absolute -inset-y-1 w-0.5 bg-warning" style={{ insetInlineStart: `${thresholdPercent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" aria-hidden="true" />Filled {filled}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent/35" aria-hidden="true" />Incoming {incoming}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-warning" aria-hidden="true" />Threshold {threshold}</span>
        <span className="ms-auto tabular-nums">Capacity {capacity} {unit}</span>
      </div>
    </div>
  );
}

export type WeekStripDay = {
  date: string;
  label: string;
  chips: Array<{ id: string; label: string; kind: "existing" | "proposed" | "conflict"; time?: string }>;
  fieldTrips?: Array<{ id: string; label: string; time?: string }>;
};

const CHIP_STYLES = {
  existing: "border border-hairline/70 bg-raised text-ink-secondary",
  proposed: "bg-accent/15 text-accent-text ring-1 ring-inset ring-accent/25",
  conflict: "bg-danger/15 text-danger ring-1 ring-inset ring-danger/25",
} satisfies Record<WeekStripDay["chips"][number]["kind"], string>;

export function WeekStrip({ days }: { days: WeekStripDay[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1" role="region" aria-label="Seven day calendar">
      <ol className="grid min-w-[700px] grid-cols-7 gap-2 sm:min-w-0" role="list">
        {days.map((day) => (
          <li key={day.date} className="min-w-0 rounded-xl bg-inset/70 p-2" role="listitem" aria-label={`${day.label}, ${day.date}`}>
            <div className="mb-2 flex items-center justify-between gap-1">
              <span className="text-[11px] font-semibold text-ink">{day.label}</span>
              <time className="text-[10px] tabular-nums text-ink-secondary" dateTime={day.date}>{day.date.slice(5)}</time>
            </div>
            <ul className="grid gap-1.5" role="list">
              {day.fieldTrips?.map((trip) => (
                <li key={trip.id} className="rounded-md bg-warning/15 px-1.5 py-1 text-[10.5px] leading-4 text-warning" role="listitem">
                  <CalendarDays size={10} className="me-1 inline" aria-hidden="true" />{trip.label}{trip.time ? ` · ${trip.time}` : ""}
                </li>
              ))}
              {day.chips.map((chip) => (
                <li key={chip.id} className={cn("rounded-md px-1.5 py-1 text-[10.5px] leading-4", CHIP_STYLES[chip.kind])} role="listitem">
                  {chip.time ? <span className="me-1 tabular-nums">{chip.time}</span> : null}{chip.label}
                </li>
              ))}
              {day.chips.length === 0 && !day.fieldTrips?.length ? <li className="py-2 text-center text-[10.5px] text-ink-secondary" role="listitem">Open</li> : null}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReplyChips({ threadId, choices, label = "Reply with" }: { threadId: string; choices: ReplyChoice[]; label?: string }) {
  if (choices.length === 0) return null;
  return (
    <div className="mt-3" aria-label={label}>
      <p className="mb-1.5 text-[11px] font-medium text-ink-secondary">{label}</p>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => composeReplyChip({ threadId, message: choice.message })}
            className={cn(
              "min-h-8 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              choice.tone === "primary"
                ? "bg-accent text-[var(--color-accent-ink)] hover:brightness-110"
                : choice.tone === "caution"
                  ? "bg-warning/15 text-warning hover:bg-warning/20"
                  : "border border-hairline/70 bg-raised text-ink hover:bg-raised-hover",
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ActionFooter({
  state,
  label,
}: {
  state: "trusted" | "browser-local" | "read-only";
  label: string;
}) {
  const icon = state === "trusted"
    ? <LockKeyhole size={12} aria-hidden="true" />
    : state === "browser-local"
      ? <CheckCircle2 size={12} aria-hidden="true" />
      : <Info size={12} aria-hidden="true" />;
  return (
    <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-inset/60 px-2.5 py-2 text-[11px] leading-4 text-ink-secondary">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

export function StatusIcon({ tone }: { tone: RowTone }) {
  if (tone === "healthy") return <CheckCircle2 size={14} className="text-success" aria-hidden="true" />;
  if (tone === "critical") return <OctagonAlert size={14} className="text-danger" aria-hidden="true" />;
  if (tone === "serious") return <CircleAlert size={14} className="text-danger" aria-hidden="true" />;
  if (tone === "warning") return <CircleAlert size={14} className="text-warning" aria-hidden="true" />;
  return <CircleDot size={14} className="text-ink-secondary" aria-hidden="true" />;
}
