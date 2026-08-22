import { ArrowLeft, Code2, LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { COMPONENT_GALLERY_MESSAGES } from "@/component-gallery";
import { ComponentRenderer } from "@/components/ui/renderer";
import { cn } from "@/lib/cn";
import type { Message } from "@/state/store";
import type { GallerySpec } from "../../server/ui/contract";
import { GALLERY } from "../../server/ui/gallery";

const GALLERY_THREAD_ID = "settings-component-gallery";

interface GalleryEntry {
  spec: GallerySpec;
  message: Message;
}

export function componentGalleryEntries(): GalleryEntry[] {
  const messages = new Map(
    COMPONENT_GALLERY_MESSAGES.flatMap((message) =>
      message.component ? [[message.component.name, message] as const] : [],
    ),
  );

  return GALLERY.flatMap((spec) => {
    const message = messages.get(spec.name);
    return message ? [{ spec, message }] : [];
  });
}

function ReadOnlyComponentPreview({ message }: { message: Message }) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    for (const control of preview.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "button, input, select, textarea",
    )) {
      control.disabled = true;
    }
    for (const link of preview.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
    }
    for (const control of preview.querySelectorAll<HTMLElement>("[role='button'], [tabindex]")) {
      control.setAttribute("aria-disabled", "true");
      control.tabIndex = -1;
    }
  }, [message]);

  return (
    <div
      ref={previewRef}
      aria-label="Read-only component example"
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onSubmitCapture={(event) => event.preventDefault()}
      role="region"
    >
      <ComponentRenderer message={message} readOnly threadId={GALLERY_THREAD_ID} />
    </div>
  );
}

function PreviewField({ message, compact = false }: { message: Message; compact?: boolean }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-inset",
        compact ? "h-[176px] border-t border-hairline/40" : "rounded-xl border border-hairline/40 p-4",
      )}
      style={{
        backgroundImage: "radial-gradient(circle, color-mix(in srgb, currentColor 12%, transparent) 0.75px, transparent 0.75px)",
        backgroundSize: "14px 14px",
      }}
    >
      {compact ? (
        <div aria-hidden="true" className="pointer-events-none w-[145%] origin-top-left scale-[0.69] select-none p-3" inert>
          <ComponentRenderer message={message} readOnly threadId={GALLERY_THREAD_ID} />
        </div>
      ) : (
        <ReadOnlyComponentPreview message={message} />
      )}
    </div>
  );
}

function GalleryOverview({
  entries,
  onSelect,
  restoreFocusName,
}: {
  entries: GalleryEntry[];
  onSelect: (name: string) => void;
  restoreFocusName: string | null;
}) {
  const overviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!restoreFocusName) return;
    const previousButton = Array.from(
      overviewRef.current?.querySelectorAll<HTMLButtonElement>("[data-gallery-name]") ?? [],
    ).find((button) => button.dataset.galleryName === restoreFocusName);
    previousButton?.focus();
  }, [restoreFocusName]);

  return (
    <div ref={overviewRef} className="pb-1">
      <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-hairline/40 bg-inset px-4 py-3">
        <div>
          <p className="text-[14px] font-medium text-ink">What bots can draw</p>
          <p className="mt-1 max-w-[54ch] text-[12.5px] leading-5 text-ink-secondary">
            Preview the structured views bots can place in a conversation instead of describing the same information in prose.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-raised px-2 py-1 text-[11px] font-medium tabular-nums text-ink-secondary">
          {entries.length} components
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {entries.map(({ spec, message }) => (
          <article
            className="group relative overflow-hidden rounded-xl border border-hairline/40 bg-card shadow-[0_1px_0_rgb(0_0_0/0.04)] transition-[border-color,box-shadow] hover:border-hairline hover:shadow-[0_8px_24px_rgb(0_0_0/0.08)] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent/20"
            key={spec.name}
          >
            <button
              type="button"
              aria-label={`View ${spec.title}`}
              className="absolute inset-0 z-20 rounded-xl outline-none active:scale-[0.96]"
              data-gallery-name={spec.name}
              onClick={() => onSelect(spec.name)}
            />
            <div className="flex min-h-[102px] flex-col p-3.5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[14px] font-semibold text-ink">{spec.title}</h3>
                <span className="rounded-md border border-hairline/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                  {spec.kind}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-[18px] text-ink-secondary">{spec.description}</p>
            </div>
            <PreviewField compact message={message} />
          </article>
        ))}
      </div>
    </div>
  );
}

function GalleryDetail({ entry, onBack }: { entry: GalleryEntry; onBack: () => void }) {
  const { spec, message } = entry;
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <div className="pb-1">
      <button
        ref={backRef}
        type="button"
        data-gallery-detail-focus
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink active:scale-[0.96]"
      >
        <ArrowLeft size={14} strokeWidth={1.8} />
        All components
      </button>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{spec.title}</h2>
            <span className="rounded-md border border-hairline/40 bg-inset px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {spec.kind}
            </span>
          </div>
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 text-ink-secondary">{spec.description}</p>
        </div>
      </div>

      <PreviewField message={message} />

      <div className="mt-4 overflow-hidden rounded-xl border border-hairline/40 bg-card">
        <div className="flex items-center gap-3 border-b border-hairline/40 px-4 py-3 last:border-b-0">
          <LayoutGrid size={15} className="text-ink-secondary" strokeWidth={1.8} />
          <span className="flex-1 text-[13px] font-medium text-ink">Kind</span>
          <span className="text-[13px] capitalize text-ink-secondary">{spec.kind}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Code2 size={15} className="text-ink-secondary" strokeWidth={1.8} />
          <span className="flex-1 text-[13px] font-medium text-ink">Called as</span>
          <code className="rounded-md bg-inset px-2 py-1 text-[11.5px] text-ink-secondary">{spec.name}</code>
        </div>
      </div>
    </div>
  );
}

export function ComponentsGallerySettings() {
  const entries = componentGalleryEntries();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastSelectedName = useRef<string | null>(null);
  const selected = entries.find(({ spec }) => spec.name === selectedName);

  useEffect(() => {
    rootRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [selectedName]);

  const select = (name: string) => {
    lastSelectedName.current = name;
    setSelectedName(name);
  };

  return (
    <div ref={rootRef}>
      {selected ? (
        <GalleryDetail entry={selected} onBack={() => setSelectedName(null)} />
      ) : (
        <GalleryOverview entries={entries} onSelect={select} restoreFocusName={lastSelectedName.current} />
      )}
    </div>
  );
}
