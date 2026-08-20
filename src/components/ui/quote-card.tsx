import { UiFrame } from "./frame";

export function QuoteCard({
  quote,
  attribution,
  context,
}: {
  quote?: string;
  attribution?: string;
  context?: string;
}) {
  if (!quote) {
    return (
      <UiFrame title="Quotation">
        <p className="text-[13px] text-ink-secondary">There is nothing to quote.</p>
      </UiFrame>
    );
  }
  return (
    <UiFrame caption={context} title="Quotation">
      <blockquote className="border-l-2 border-hairline pl-4">
        <p className="text-[15px] leading-relaxed text-ink">{quote}</p>
        {attribution ? <footer className="mt-2 text-[12px] text-ink-secondary">{attribution}</footer> : null}
      </blockquote>
    </UiFrame>
  );
}
