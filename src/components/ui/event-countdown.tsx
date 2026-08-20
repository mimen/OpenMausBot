import { CheckCircle2, Clock3, ExternalLink, OctagonAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { formatDateTimeInZone, humanizeTimeZone } from "@/lib/ui/format";
import type { EventCountdown as EventCountdownData } from "../../../server/ui/schemas.ts";
import { GeneralRow, LoopFrame } from "./grammar";
import { UiBadge, UiFrame } from "./frame";

type CountdownState = { label: string; passed: boolean };

function countdown(target: string, now: number): CountdownState {
  const at = Date.parse(target);
  if (!Number.isFinite(at)) return { label: "Doors time unavailable", passed: false };
  const delta = at - now;
  const totalSeconds = Math.max(0, Math.floor(Math.abs(delta) / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const label = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { label: delta >= 0 ? label : `${label} since doors`, passed: delta < 0 };
}

export function EventCountdown({ data }: { data: EventCountdownData }) {
  const openId = useId();
  const completedId = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const timer = countdown(data.doorsAt, now);
  const completed = data.blockers.filter((blocker) => blocker.status === "completed");
  const open = data.blockers.filter((blocker) => blocker.status === "open");
  const doors = formatDateTimeInZone(data.doorsAt, data.timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) ?? "Time unavailable";
  return (
    <UiFrame title={data.title} caption={`Doors · ${doors} · ${humanizeTimeZone(data.timeZone)}`} action={<UiBadge tone={open.length ? "caution" : "positive"}>{open.length} open</UiBadge>}>
      <div className={timer.passed ? "rounded-xl bg-warning/12 px-3 py-3" : "rounded-xl bg-accent/10 px-3 py-3"} role="timer" aria-live="off">
        <div className="flex items-center gap-2">
          <Clock3 size={17} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <div>
            <p className="text-[10.5px] font-medium text-ink-secondary">{timer.passed ? "Doors opened" : "Time to doors"}</p>
            <p className="mt-0.5 text-[24px] font-semibold leading-none tabular-nums text-ink">{timer.label}</p>
          </div>
        </div>
      </div>
      <div className="mt-3"><LoopFrame frame={data.frame} /></div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <section aria-labelledby={openId}>
          <h3 id={openId} className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink"><OctagonAlert size={13} className="text-warning" aria-hidden="true" />Open blockers</h3>
          {open.length ? <div className="divide-y divide-hairline/30">{open.map((row) => (
            <GeneralRow
              key={row.id}
              tone="warning"
              title={row.label}
              detail={row.evidence}
              metadata={row.owner ? <span>Owner {row.owner}</span> : null}
              trailing={row.nextMove ? <span className="max-w-[220px] text-[11px] leading-4 text-ink-secondary">{row.nextMove}</span> : null}
            />
          ))}</div> : <p className="rounded-lg bg-success/10 px-3 py-3 text-[12px] text-success" role="status">No open blockers.</p>}
        </section>
        <section aria-labelledby={completedId}>
          <h3 id={completedId} className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink"><CheckCircle2 size={13} className="text-success" aria-hidden="true" />Completed</h3>
          <div className="divide-y divide-hairline/30">{completed.map((row) => (
            <GeneralRow key={row.id} tone="healthy" title={row.label} detail={row.evidence} metadata={row.owner ? <span>Owner {row.owner}</span> : null} completed />
          ))}</div>
        </section>
      </div>
      {data.draftReadyLinks.length ? (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Draft-ready event links">
          {data.draftReadyLinks.map((link) => (
            <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/70 bg-raised px-2.5 py-1.5 text-[11.5px] font-medium text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {link.label}<ExternalLink size={11} aria-hidden="true" />
            </a>
          ))}
        </nav>
      ) : null}
      <div className="mt-4 rounded-xl bg-inset/70 px-3 py-2.5">
        <p className="text-[10.5px] font-medium text-ink-secondary">Next move</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-ink">{data.nextMove}</p>
      </div>
    </UiFrame>
  );
}
