import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "positive" | "caution" | "negative";

const TONES = {
  neutral: "bg-raised text-ink-secondary",
  positive: "bg-success/15 text-success",
  caution: "bg-warning/15 text-warning",
  negative: "bg-danger/15 text-danger",
} satisfies Record<Tone, string>;

export function UiFrame({
  title,
  caption,
  action,
  children,
}: {
  title?: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="w-full max-w-[840px] overflow-hidden rounded-2xl border border-hairline/40 bg-card">
      {(title || action) && (
        <figcaption className="flex items-start justify-between gap-4 border-b border-hairline/40 px-4 py-3">
          <div className="min-w-0">
            {title ? <p className="truncate text-[15px] font-semibold text-ink">{title}</p> : null}
            {caption ? <p className="mt-0.5 text-[13px] text-ink-secondary">{caption}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </figcaption>
      )}
      <div className="px-4 py-3">{children}</div>
    </figure>
  );
}

export function UiBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

export function asTone(value: string | undefined): Tone | undefined {
  if (value === "neutral" || value === "positive" || value === "caution" || value === "negative") return value;
  return undefined;
}
