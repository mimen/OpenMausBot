import { CalendarCheck2, Scissors, TriangleAlert } from "lucide-react";

import {
  formatDateTimeInZone,
  humanizeBookingRelation,
  humanizeTimeZone,
} from "@/lib/ui/format";
import type { BookingSlot as BookingSlotData } from "../../../server/ui/schemas.ts";
import { ActionFooter, GeneralRow, LoopFrame, ReplyChips } from "./grammar";
import { UiFrame } from "./frame";

export function BookingSlot({ data, threadId }: { data: BookingSlotData; threadId: string }) {
  const day = formatDateTimeInZone(data.candidate.startsAt, data.candidate.timeZone, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const start = formatDateTimeInZone(data.candidate.startsAt, data.candidate.timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = formatDateTimeInZone(data.candidate.endsAt, data.candidate.timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const slot = day && start && end ? `${day} · ${start}–${end}` : data.candidate.label;
  return (
    <UiFrame title={data.title} caption={`Last cut ${data.lastCutAge} ago`}>
      {data.frame ? <LoopFrame frame={data.frame} /> : null}
      <section className={`rounded-xl bg-accent/10 p-4 ${data.frame ? "mt-4" : ""}`} aria-label="Candidate slot">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"><Scissors size={17} aria-hidden="true" /></span>
          <div>
            <p className="text-[11px] font-medium text-ink-secondary">Candidate</p>
            <p className="mt-0.5 text-[16px] font-semibold leading-6 text-ink">{data.candidate.label}</p>
            <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-secondary">{slot} · {humanizeTimeZone(data.candidate.timeZone)}</p>
          </div>
        </div>
      </section>
      <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2.5 text-warning" role="status">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-[11.5px] font-semibold">Square availability is unverified</p>
          <p className="mt-0.5 text-[11.5px] leading-5 text-ink-secondary">{data.square.label}</p>
        </div>
      </div>
      {data.surroundingFit.length > 0 ? (
        <section className="mt-4" aria-labelledby="booking-fit">
          <h3 id="booking-fit" className="mb-1 text-[12px] font-semibold text-ink">Surrounding calendar fit</h3>
          <div className="divide-y divide-hairline/30">
            {data.surroundingFit.map((event) => (
              <GeneralRow
                key={event.id}
                tone={event.relation === "overlap" ? "critical" : event.relation === "buffer" ? "healthy" : "neutral"}
                leading={<CalendarCheck2 size={14} aria-hidden="true" />}
                title={event.label}
                metadata={<><span>{event.timing}</span><span>{humanizeBookingRelation(event.relation)}</span></>}
              />
            ))}
          </div>
        </section>
      ) : null}
      <ReplyChips threadId={threadId} choices={data.replies} label="Approve the exact slot or ask for another day" />
      <ActionFooter state="read-only" label="This card neither opens Square nor books an appointment. Replying gives the exact slot decision back to the bot." />
    </UiFrame>
  );
}
