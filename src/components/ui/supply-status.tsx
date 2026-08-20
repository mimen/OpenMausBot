import { Clock3, PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { SupplyStatus as SupplyStatusData } from "../../../server/ui/schemas.ts";
import { ActionFooter, Gauge, LoopFrame, ReplyChips } from "./grammar";
import { UiBadge, UiFrame } from "./frame";

function timeUntil(value: string, now: number): string {
  const target = Date.parse(value);
  if (!Number.isFinite(target)) return "Deadline unavailable";
  const delta = target - now;
  const absoluteMinutes = Math.max(0, Math.round(Math.abs(delta) / 60_000));
  const days = Math.floor(absoluteMinutes / 1_440);
  const hours = Math.floor((absoluteMinutes % 1_440) / 60);
  const minutes = absoluteMinutes % 60;
  const amount = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return delta >= 0 ? `${amount} remaining` : `${amount} past deadline`;
}

function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function SupplyStatus({ data, threadId }: { data: SupplyStatusData; threadId: string }) {
  const now = useMinuteNow();
  const cost = data.cost
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: data.cost.currency }).format(data.cost.amount)
    : null;
  return (
    <UiFrame title={data.title} caption={data.cost?.label} action={<UiBadge tone={data.recommendation.tone}>{data.bottles.total} bottles</UiBadge>}>
      {data.frame ? <LoopFrame frame={data.frame} /> : null}
      <div className={`rounded-xl px-3 py-3 ${data.frame ? "mt-4" : ""} ${
        data.recommendation.tone === "positive"
          ? "bg-success/12"
          : data.recommendation.tone === "negative"
            ? "bg-danger/12"
            : data.recommendation.tone === "caution"
              ? "bg-warning/12"
              : "bg-inset/70"
      }`}>
        <div className="flex items-start gap-2">
          <PackageCheck size={17} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
          <div>
            <p className="text-[14px] font-semibold text-ink">{data.recommendation.label}</p>
            {data.recommendation.detail ? <p className="mt-0.5 text-[12px] leading-5 text-ink-secondary">{data.recommendation.detail}</p> : null}
          </div>
        </div>
      </div>
      <div className="mt-3"><Gauge {...data.gauge} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["On hand", data.bottles.onHand],
          ["Incoming", data.bottles.incoming],
          ["Total", data.bottles.total],
          ["Cost", cost ?? "Not supplied"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg bg-inset/60 px-2.5 py-2">
            <dt className="text-[10.5px] text-ink-secondary">{label}</dt>
            <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {data.agingDeadline ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[11.5px] text-warning" role="timer" aria-live="off">
          <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">{timeUntil(data.agingDeadline.at, now)}</strong> · {data.agingDeadline.label}</span>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Provenance">
        {data.provenance.map((item) => (
          <span key={`${item.label}-${item.value ?? ""}`} className="rounded-md bg-raised px-1.5 py-1 text-[10.5px] text-ink-secondary">
            {item.label}{item.value ? ` · ${item.value}` : ""}
          </span>
        ))}
      </div>
      <ReplyChips threadId={threadId} choices={data.replies} label="Tell the bot what to do next" />
      <ActionFooter state="read-only" label="Reply choices only compose a message to the bot. This component never changes ReadyRefresh or another supplier account." />
    </UiFrame>
  );
}
