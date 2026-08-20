import type { JsonObject } from "../server/contracts.ts";
import type { ComponentCall } from "../server/ui/contract.ts";
import { ComponentRenderer } from "./components/ui/renderer";
import type { Message } from "./state/store";

const THREAD_ID = "component-gallery-thread";
const NOW = "2026-08-20T17:00:00.000Z";

function message(name: string, argumentsObject: JsonObject, index: number): Message {
  const component: ComponentCall = {
    callId: `gallery-call-${index}`,
    name,
    arguments: argumentsObject,
    result: "Gallery fixture rendered.",
    status: "shown",
    origin: { provider: "gallery" },
  };
  return {
    id: `gallery-message-${index}`,
    at: Date.parse(NOW) + index,
    parentId: index === 0 ? null : `gallery-message-${index - 1}`,
    role: "bot",
    kind: "component",
    text: component.result,
    component,
  };
}

const frame = {
  openCount: 3,
  delta: -2,
  source: "Ops Watch",
  freshness: { label: "Checked 4 min ago", checkedAt: NOW },
  owner: "Milad",
} as const;

export const COMPONENT_GALLERY_MESSAGES: Message[] = [
  message("show_status_board", {
    title: "Portfolio status",
    frame,
    summary: "Resolved work stays visible long enough to understand the delta; only three items still need attention.",
    groups: [
      { kind: "resolved", rows: [{ id: "deploy", label: "Heroku deploy recovered", severity: "healthy", since: "16:22", owner: "Ops Watch", evidence: "All four apps now report a healthy release.", nextMove: "Keep the next scheduled check." }] },
      { kind: "new", rows: [{ id: "token", label: "ReadyRefresh token ages out tomorrow", severity: "warning", since: "today", owner: "Milad", evidence: "The current session expires before the next delivery window.", nextMove: "Choose keep or skip after checking bottle count." }] },
      { kind: "awaiting", rows: [{ id: "reply", label: "Promoter needs exact guest-list answer", severity: "serious", since: "2h", owner: "Milad", evidence: "Draft is ready; the final count is the only open fact.", nextMove: "Reply with the confirmed count." }] },
      { kind: "still_open", rows: [{ id: "asset", label: "Event recap asset handoff", severity: "info", since: "yesterday", owner: "Design", nextMove: "Confirm the final download folder." }] },
      { kind: "healthy", rows: [{ id: "sync", label: "Vault sync", severity: "healthy", owner: "Obsidian Sync", evidence: "Laptop and Mini are current." }] },
    ],
  }, 0),
  message("show_supplement_stack", {
    title: "Today’s supplement stack",
    date: "2026-08-20",
    timeZone: "America/Los_Angeles",
    regimen: { version: "v2026.08", snapshotAt: NOW, source: "Supplement protocol" },
    groups: [
      { period: "am", items: [{ id: "creatine", label: "Creatine", dose: "5 g", checked: true }, { id: "vitamin-d", label: "Vitamin D3", dose: "2,000 IU", note: "With food", checked: false }] },
      { period: "pm", items: [{ id: "magnesium", label: "Magnesium glycinate", dose: "240 mg", checked: false }] },
      { period: "situational", items: [{ id: "electrolytes", label: "Electrolytes", note: "Long workout or high heat", situational: true, checked: false }] },
    ],
  }, 1),
  message("show_week_calendar", {
    title: "Kira’s week",
    frame: { ...frame, source: "Calendar proposal", openCount: 2, delta: 0 },
    weekStart: "2026-08-17",
    timeZone: "America/Los_Angeles",
    days: [
      { date: "2026-08-17", label: "Mon", chips: [{ id: "m1", label: "School", kind: "existing", time: "8:00" }] },
      { date: "2026-08-18", label: "Tue", chips: [{ id: "t1", label: "Walker · Leah", kind: "proposed", time: "15:30" }], walkers: [{ id: "w1", label: "Leah", assignment: "Afternoon walk after school" }] },
      { date: "2026-08-19", label: "Wed", chips: [{ id: "w2", label: "Dinner overlap", kind: "conflict", time: "18:00" }] },
      { date: "2026-08-20", label: "Thu", chips: [{ id: "h1", label: "School", kind: "existing", time: "8:00" }], fieldTrips: [{ id: "ft1", label: "Science museum", time: "09:15" }] },
      { date: "2026-08-21", label: "Fri", chips: [{ id: "f1", label: "Walker · Milad", kind: "proposed", time: "15:30" }], walkers: [{ id: "w2", label: "Milad", assignment: "Pickup and evening walk" }] },
      { date: "2026-08-22", label: "Sat", chips: [] },
      { date: "2026-08-23", label: "Sun", chips: [{ id: "s1", label: "Family lunch", kind: "existing", time: "13:00" }] },
    ],
    relevantContext: ["Thursday’s field trip changes the normal pickup window.", "Friday evening stays open after 19:00."],
    proposalExclusions: ["No new event before school drop-off.", "Do not schedule over the Wednesday dinner conflict."],
    replies: [{ id: "approve-week", label: "Approve this week", message: "Approve the proposed Kira week exactly as shown, including the walker assignments and exclusions.", tone: "primary" }, { id: "change-day", label: "Change a day", message: "Keep the proposal, but help me change one day before I approve it." }],
  }, 2),
  message("show_supply_status", {
    title: "Water supply",
    frame: { ...frame, source: "ReadyRefresh receipt + bottle count", openCount: 1, delta: 0 },
    recommendation: { label: "Keep the next delivery", detail: "Two bottles on hand plus three incoming clears the four-bottle threshold before the aging deadline.", tone: "positive" },
    gauge: { filled: 2, incoming: 3, threshold: 4, capacity: 6, unit: "bottles" },
    bottles: { onHand: 2, incoming: 3, total: 5 },
    cost: { amount: 31.47, currency: "USD", label: "Next delivery total" },
    agingDeadline: { at: "2026-08-21T18:00:00-07:00", label: "Change the order before the delivery locks." },
    provenance: [{ label: "Bottle count", value: "Local reply" }, { label: "Delivery", value: "ReadyRefresh read-only receipt" }],
    replies: [{ id: "count", label: "I have 2 bottles", message: "I have 2 full bottles on hand. Recalculate the recommendation with that exact count." }, { id: "keep", label: "Keep delivery", message: "Keep the recommended delivery. Explain the next step without changing ReadyRefresh.", tone: "primary" }, { id: "skip", label: "Consider skipping", message: "Show me the case for skipping this delivery before I decide." }],
  }, 3),
  message("show_conversation", {
    title: "Leah · event logistics",
    frame: { ...frame, source: "Inbox Closer", openCount: 1, delta: 0, owner: "Milad" },
    surface: "imessage",
    age: "2 hours old",
    stakes: "high",
    bubbles: [
      { id: "c1", direction: "inbound", text: "Can you confirm the final guest-list count before 6?", at: "2026-08-20T14:42:00-07:00" },
      { id: "c2", direction: "outbound", text: "Yes, I’ll check it and get you the exact number today.", at: "2026-08-20T14:45:00-07:00" },
      { id: "c3", direction: "inbound", text: "Perfect, thank you.", at: "2026-08-20T14:46:00-07:00" },
    ],
    owedReason: "Milad promised the exact count today; Leah is waiting before she closes the list.",
    draft: { body: "Final count is 42. That includes the two artist guests and excludes staff credentials.", status: "needs_edit" },
    replies: [{ id: "edit", label: "Edit the draft", message: "Help me edit this draft while preserving the exact count and exclusions." }, { id: "mint", label: "Request send approval", message: "The draft is ready. Prepare the editable claude-actions approval surface for this iMessage, but do not send directly.", tone: "primary" }],
  }, 4),
  message("show_booking_slot", {
    title: "Haircut candidate",
    frame: { ...frame, source: "Calendar fit", openCount: 1, delta: 0 },
    candidate: { startsAt: "2026-08-26T14:30:00-07:00", endsAt: "2026-08-26T15:15:00-07:00", timeZone: "America/Los_Angeles", label: "Wednesday afternoon" },
    lastCutAge: "6 weeks",
    surroundingFit: [{ id: "b1", label: "Work block ends", timing: "13:45", relation: "before" }, { id: "b2", label: "Travel buffer", timing: "45 min", relation: "buffer" }, { id: "b3", label: "Dinner", timing: "18:30", relation: "after" }],
    square: { status: "unverified", label: "The calendar fit is real; Square availability has not been opened or checked." },
    replies: [{ id: "slot", label: "Approve exact slot", message: "Approve Wednesday August 26 from 2:30–3:15 PM as the exact candidate. Do not open or book Square yet.", tone: "primary" }, { id: "different", label: "Try another day", message: "Find a different day with the same calendar-fit constraints. Keep Square unverified." }],
  }, 5),
  message("show_event_countdown", {
    title: "Glizzy Galaxy",
    frame: { ...frame, source: "Event Watch", openCount: 2, delta: -1, owner: "Event team" },
    doorsAt: "2026-08-22T21:00:00-07:00",
    timeZone: "America/Los_Angeles",
    blockers: [
      { id: "e1", label: "Final flyer exported", status: "completed", owner: "Design", evidence: "All five standard sizes are in the handoff folder." },
      { id: "e2", label: "Artist credentials", status: "open", owner: "Leah", evidence: "Two names are still unconfirmed.", nextMove: "Confirm by Friday noon." },
      { id: "e3", label: "Door brief", status: "open", owner: "Milad", nextMove: "Approve the final guest-list count." },
    ],
    draftReadyLinks: [{ id: "link1", label: "Door brief draft", url: "https://example.com/door-brief" }, { id: "link2", label: "Asset folder", url: "https://example.com/assets" }],
    nextMove: "Approve the guest-list count, then hand the final door brief to venue staff.",
  }, 6),
];

export function ComponentGallery() {
  return (
    <main className="min-h-full bg-app px-4 py-8 text-ink sm:px-8" data-component-gallery>
      <header className="mx-auto mb-8 max-w-[900px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-text">OpenMaus compiled component grammar</p>
        <h1 className="mt-2 text-balance text-[30px] font-semibold tracking-[-0.035em]">One conversational system, seven purpose-built views.</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-6 text-ink-secondary">Fixture-only evidence. No provider call, external write, credential, ReadyRefresh action, message send, Square booking, or calendar mutation runs on this route.</p>
      </header>
      <div className="mx-auto grid max-w-[900px] gap-6">
        {COMPONENT_GALLERY_MESSAGES.map((item) => <ComponentRenderer key={item.id} message={item} threadId={THREAD_ID} />)}
      </div>
    </main>
  );
}
