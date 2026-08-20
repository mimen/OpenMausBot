import { Check } from "lucide-react";
import { UiBadge, UiFrame } from "./frame";

export type ChecklistItem = { text: string; done: boolean; note?: string };

export function ChecklistCard({
  title,
  caption,
  items = [],
}: {
  title?: string;
  caption?: string;
  items?: ChecklistItem[];
}) {
  const done = items.filter((item) => item.done).length;
  return (
    <UiFrame
      action={
        <UiBadge tone={done === items.length && items.length > 0 ? "positive" : "neutral"}>
          {done} of {items.length} completed
        </UiBadge>
      }
      caption={caption}
      title={title}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {done} of {items.length} checklist items completed.
      </p>
      <ul className="space-y-2" aria-busy="false" aria-label={`${done} of ${items.length} checklist items completed`}>
        {items.map((item, index) => (
          <li className="flex items-start gap-2.5 text-[13px]" key={`${index}-${item.text}`}>
            <span className="sr-only">{item.done ? "Completed: " : "Not completed: "}</span>
            <span
              aria-hidden="true"
              className={
                item.done
                  ? "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-success text-app"
                  : "mt-0.5 flex size-4 shrink-0 rounded-[5px] border border-hairline"
              }
            >
              {item.done ? <Check size={10} /> : null}
            </span>
            <span className="min-w-0">
              <span className={item.done ? "text-ink-secondary" : "text-ink"}>{item.text}</span>
              {item.note ? <span className="block text-[12px] text-ink-secondary">{item.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </UiFrame>
  );
}
