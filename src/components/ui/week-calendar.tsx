import { Footprints, ShieldAlert } from "lucide-react";
import { useId } from "react";

import { humanizeTimeZone } from "@/lib/ui/format";
import type { WeekCalendar as WeekCalendarData } from "../../../server/ui/schemas.ts";
import { ActionFooter, GeneralRow, LoopFrame, ReplyChips, WeekStrip } from "./grammar";
import { UiFrame } from "./frame";

export function WeekCalendar({ data, threadId }: { data: WeekCalendarData; threadId: string }) {
  const walkersId = useId();
  const walkers = data.days.flatMap((day) => (day.walkers ?? []).map((walker) => ({ ...walker, day: day.label })));
  return (
    <UiFrame title={data.title} caption={`Week of ${data.weekStart} · ${humanizeTimeZone(data.timeZone)}`}>
      {data.frame ? <LoopFrame frame={data.frame} /> : null}
      <div className={data.frame ? "mt-4" : ""}>
        <WeekStrip days={data.days} />
      </div>
      {walkers.length > 0 ? (
        <section className="mt-4" aria-labelledby={walkersId}>
          <h3 id={walkersId} className="mb-1 text-[12px] font-semibold text-ink">Walker assignments</h3>
          <div className="divide-y divide-hairline/30">
            {walkers.map((walker) => (
              <GeneralRow
                key={`${walker.day}-${walker.id}`}
                tone="info"
                leading={<Footprints size={14} aria-hidden="true" />}
                title={walker.label}
                detail={walker.assignment}
                metadata={<span>{walker.day}</span>}
              />
            ))}
          </div>
        </section>
      ) : null}
      {(data.relevantContext?.length || data.proposalExclusions?.length) ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.relevantContext?.length ? (
            <section className="rounded-xl bg-inset/70 p-3">
              <h3 className="text-[11.5px] font-semibold text-ink">Relevant context</h3>
              <ul className="mt-1.5 grid gap-1 text-[11.5px] leading-5 text-ink-secondary">
                {data.relevantContext.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            </section>
          ) : null}
          {data.proposalExclusions?.length ? (
            <section className="rounded-xl bg-warning/10 p-3">
              <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warning"><ShieldAlert size={13} aria-hidden="true" />Excluded from this proposal</h3>
              <ul className="mt-1.5 grid gap-1 text-[11.5px] leading-5 text-ink-secondary">
                {data.proposalExclusions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      <ReplyChips threadId={threadId} choices={data.replies} label="Approve or revise in chat" />
      <ActionFooter state="read-only" label="This is a structured proposal. Replying informs the bot; no Google Calendar write handler exists in this slice." />
    </UiFrame>
  );
}
