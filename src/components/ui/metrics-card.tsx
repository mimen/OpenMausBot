import { asTone, UiBadge, UiFrame } from "./frame";

export type Metric = { label: string; value: string; change?: string; changeTone?: string };

export function MetricsCard({
  title,
  caption,
  metrics = [],
}: {
  title?: string;
  caption?: string;
  metrics?: Metric[];
}) {
  return (
    <UiFrame caption={caption} title={title}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {metrics.map((metric, index) => (
          <div key={`${index}-${metric.label}`}>
            <p className="truncate text-[12px] text-ink-secondary">{metric.label}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink">{metric.value}</p>
            {metric.change ? (
              <p className="mt-0.5">
                <UiBadge tone={asTone(metric.changeTone)}>{metric.change}</UiBadge>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </UiFrame>
  );
}
