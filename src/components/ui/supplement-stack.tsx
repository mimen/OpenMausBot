import { Circle, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type ComponentCall } from "@/state/store";
import type { SupplementStack as SupplementStackData } from "../../../server/ui/schemas.ts";
import { ActionFooter, GeneralRow } from "./grammar";
import { UiBadge, UiFrame } from "./frame";

const PERIOD_LABELS = { am: "Morning", pm: "Evening", situational: "Situational" } as const;

export type SupplementToggleState = { checked: boolean; pending: boolean; baseChecked: boolean; error?: string };

export function reconcileSupplementOverlays(
  current: Record<string, SupplementToggleState>,
  serverChecked: ReadonlyMap<string, boolean>,
): Record<string, SupplementToggleState> {
  const next = { ...current };
  let changed = false;
  for (const [itemId, overlay] of Object.entries(current)) {
    const checked = serverChecked.get(itemId);
    if (!overlay.pending && checked !== undefined && (checked === overlay.checked || checked !== overlay.baseChecked)) {
      delete next[itemId];
      changed = true;
    }
  }
  return changed ? next : current;
}

export function SupplementStack({
  call,
  data,
  threadId,
}: {
  call: ComponentCall;
  data: SupplementStackData;
  threadId: string;
}) {
  const serverChecked = useMemo(() => new Map(data.groups.flatMap((group) =>
    group.items.map((item) => [item.id, item.checked === true] as const),
  )), [data]);
  const [state, setState] = useState<Record<string, SupplementToggleState>>({});
  useEffect(() => {
    setState((current) => reconcileSupplementOverlays(current, serverChecked));
  }, [serverChecked]);
  const normalItems = data.groups.flatMap((group) => group.period === "situational" ? [] : group.items);
  const completed = normalItems.filter((item) => state[item.id]?.checked ?? (item.checked === true)).length;

  const toggle = async (itemId: string, checked: boolean) => {
    const previous = state[itemId]?.checked === true;
    if (state[itemId]?.pending || previous === checked) return;
    setState((current) => ({ ...current, [itemId]: { checked, pending: true, baseChecked: previous } }));
    try {
      await api("/api/ui/supplements/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          threadId,
          callId: call.callId,
          itemId,
          date: data.date,
          checked,
        }),
      });
      setState((current) => ({ ...current, [itemId]: { checked, pending: false, baseChecked: previous } }));
    } catch (error) {
      setState((current) => ({
        ...current,
        [itemId]: {
          checked: previous,
          pending: false,
          baseChecked: previous,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  return (
    <UiFrame
      title={data.title}
      caption={`${data.date} · ${data.timeZone} · regimen ${data.regimen.version}`}
      action={<UiBadge tone={completed === normalItems.length && normalItems.length > 0 ? "positive" : "neutral"}>{completed} / {normalItems.length}</UiBadge>}
    >
      <div className="grid gap-5">
        {data.groups.map((group) => (
          <section key={group.period} aria-labelledby={`supplement-${call.callId}-${group.period}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 id={`supplement-${call.callId}-${group.period}`} className="text-[12px] font-semibold text-ink">{group.label ?? PERIOD_LABELS[group.period]}</h3>
              {group.period === "situational" ? <span className="text-[10.5px] text-ink-secondary">Use when relevant, not as a daily tick</span> : null}
            </div>
            <div className="divide-y divide-hairline/30">
              {group.items.map((item) => {
                const checked = item.checked === true;
                const row = state[item.id] ?? { checked, pending: false, baseChecked: checked };
                const situational = group.period === "situational" || item.situational === true;
                return (
                  <GeneralRow
                    key={item.id}
                    tone={row.checked ? "healthy" : situational ? "info" : "neutral"}
                    leading={situational ? <Sparkles size={15} aria-hidden="true" /> : null}
                    title={item.label}
                    detail={
                      <>
                        {item.note ? <span>{item.note}</span> : null}
                        {row.error ? <span role="alert" className="block text-danger">{row.error}</span> : null}
                      </>
                    }
                    metadata={item.dose ? <span>{item.dose}</span> : null}
                    completed={row.checked}
                    trailing={situational ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-ink-secondary"><Circle size={10} aria-hidden="true" />As needed</span>
                    ) : (
                      <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-raised-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          aria-disabled={row.pending}
                          onChange={(event) => void toggle(item.id, event.target.checked)}
                          className="size-4 accent-[var(--color-accent)]"
                        />
                        {row.pending ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                        {row.checked ? "Taken" : "Mark taken"}
                      </label>
                    )}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <ActionFooter
        state="browser-local"
        label={`Ticks are stored only in this local OpenMaus ledger for ${data.date}. They never edit the regimen source or vault protocol.`}
      />
    </UiFrame>
  );
}
