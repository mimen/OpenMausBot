import { FilePenLine, MessageCircleMore, ShieldCheck } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/cn";
import type { Conversation as ConversationData } from "../../../server/ui/schemas.ts";
import { ActionFooter, LoopFrame, ReplyChips } from "./grammar";
import { UiBadge, UiFrame } from "./frame";

const STAKE_TONE = {
  low: "neutral",
  medium: "caution",
  high: "negative",
  critical: "negative",
} as const;

export function Conversation({ data, threadId }: { data: ConversationData; threadId: string }) {
  const draftId = useId();
  return (
    <UiFrame
      title={data.title}
      caption={`${data.surface} · ${data.age}`}
      action={<UiBadge tone={STAKE_TONE[data.stakes]}>{data.stakes} stakes</UiBadge>}
    >
      {data.frame ? <LoopFrame frame={data.frame} /> : null}
      <div className={`flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 ${data.frame ? "mt-4" : ""}`}>
        <MessageCircleMore size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="text-[11px] font-semibold text-warning">Why a reply is owed</p>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-secondary">{data.owedReason}</p>
        </div>
      </div>
      <ol className="mt-4 grid gap-2" aria-label="Recent conversation">
        {data.bubbles.map((bubble) => (
          <li key={bubble.id} className={cn("flex", bubble.direction === "outbound" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[88%] rounded-2xl px-3 py-2 sm:max-w-[72%]",
              bubble.direction === "outbound" ? "bg-bubble-user text-ink" : "bg-inset text-ink",
            )}>
              <p className="whitespace-pre-wrap text-[12.5px] leading-5 [overflow-wrap:anywhere]">{bubble.text}</p>
              <time dateTime={bubble.at} className="mt-1 block text-[10px] tabular-nums text-ink-secondary">{new Date(bubble.at).toLocaleString()}</time>
            </div>
          </li>
        ))}
      </ol>
      <section className="mt-4 rounded-xl bg-inset/70 p-3" aria-labelledby={draftId}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id={draftId} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink"><FilePenLine size={13} aria-hidden="true" />Draft</h3>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-secondary"><ShieldCheck size={12} aria-hidden="true" />{data.draft.status.replaceAll("_", " ")}</span>
        </div>
        <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink [overflow-wrap:anywhere]">{data.draft.body}</p>
      </section>
      <ReplyChips threadId={threadId} choices={data.replies} label="Edit or request approval setup" />
      <ActionFooter state="read-only" label="Nothing sends from this card. A mint request tells the bot to prepare the claude-actions editable approval surface; messaging credentials never enter the component." />
    </UiFrame>
  );
}
