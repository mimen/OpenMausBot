export const REPLY_CHIP_PREFILL_EVENT = "openmaus:reply-chip-prefill";

export type ReplyChipPrefill = {
  threadId: string;
  message: string;
};

declare global {
  interface WindowEventMap {
    "openmaus:reply-chip-prefill": CustomEvent<ReplyChipPrefill>;
  }
}

export function mergeReplyChipPrefill(current: string, message: string): string {
  const next = message.trim();
  if (!next) return current;
  const existing = current.trim();
  return existing ? `${existing}\n\n${next}` : next;
}

export function composeReplyChip(detail: ReplyChipPrefill): void {
  window.dispatchEvent(new CustomEvent<ReplyChipPrefill>(REPLY_CHIP_PREFILL_EVENT, { detail }));
}
