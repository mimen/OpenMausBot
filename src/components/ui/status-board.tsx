import type { StatusBoard as StatusBoardData } from "../../../server/ui/schemas.ts";
import { GeneralRow, LoopFrame, StatusIcon } from "./grammar";
import { UiBadge, UiFrame } from "./frame";

const GROUP_LABELS = {
  resolved: "Resolved",
  new: "New",
  awaiting: "Awaiting",
  still_open: "Still open",
  healthy: "Healthy",
} satisfies Record<StatusBoardData["groups"][number]["kind"], string>;

export function StatusBoard({ data }: { data: StatusBoardData }) {
  const rows = data.groups.reduce((count, group) => count + group.rows.length, 0);
  const quiet = data.frame.openCount === 0 && data.quietState;
  return (
    <UiFrame title={data.title} caption={data.summary} action={<UiBadge tone={quiet ? "positive" : "neutral"}>{rows} signals</UiBadge>}>
      <LoopFrame frame={data.frame} />
      {quiet ? (
        <div className="py-8 text-center" role="status">
          <p className="text-[14px] font-medium text-ink">{data.quietState?.label}</p>
          {data.quietState?.detail ? <p className="mx-auto mt-1 max-w-[60ch] text-[12.5px] leading-5 text-ink-secondary">{data.quietState.detail}</p> : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          {data.groups.filter((group) => group.rows.length > 0).map((group) => (
            <section key={group.kind} aria-labelledby={`status-${group.kind}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 id={`status-${group.kind}`} className="text-[12px] font-semibold text-ink">{group.label ?? GROUP_LABELS[group.kind]}</h3>
                <span className="rounded-md border border-hairline/70 bg-raised px-1.5 py-0.5 text-[10.5px] tabular-nums text-ink-secondary">{group.rows.length}</span>
              </div>
              <div className="divide-y divide-hairline/30">
                {group.rows.map((row) => (
                  <GeneralRow
                    key={row.id}
                    tone={row.severity}
                    leading={<StatusIcon tone={row.severity} />}
                    title={row.label}
                    detail={row.evidence}
                    metadata={
                      <>
                        {row.since ? <span>Since {row.since}</span> : null}
                        {row.owner ? <span>Owner {row.owner}</span> : null}
                        {row.service ? <span>{row.service}</span> : null}
                      </>
                    }
                    trailing={row.nextMove ? <span className="max-w-[280px] text-[11.5px] leading-4 text-ink-secondary">Next: {row.nextMove}</span> : null}
                    completed={group.kind === "resolved"}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </UiFrame>
  );
}
