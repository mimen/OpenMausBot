import { asTone, UiBadge, UiFrame } from "./frame";

export type RecordField = { label: string; value: string };

export function RecordCard({
  title,
  subtitle,
  status,
  statusTone,
  fields = [],
}: {
  title?: string;
  subtitle?: string;
  status?: string;
  statusTone?: string;
  fields?: RecordField[];
}) {
  return (
    <UiFrame action={status ? <UiBadge tone={asTone(statusTone)}>{status}</UiBadge> : undefined} caption={subtitle} title={title}>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-[13px]">
        {fields.map((field) => (
          <div className="contents" key={field.label}>
            <dt className="truncate text-ink-secondary">{field.label}</dt>
            <dd className="min-w-0 break-words text-ink">{field.value}</dd>
          </div>
        ))}
      </dl>
    </UiFrame>
  );
}
