const SURFACE_LABELS = {
  imessage: "iMessage",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  slack: "Slack",
  email: "Email",
  sms: "SMS",
  other: "Other",
} as const;

const BOOKING_RELATION_LABELS = {
  before: "Before the slot",
  after: "After the slot",
  overlap: "Overlaps the slot",
  buffer: "Buffer around the slot",
} as const;

export function humanizeSurface(surface: keyof typeof SURFACE_LABELS): string {
  return SURFACE_LABELS[surface];
}

export function humanizeBookingRelation(relation: keyof typeof BOOKING_RELATION_LABELS): string {
  return BOOKING_RELATION_LABELS[relation];
}

export function humanizeTimeZone(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ").trim();
  return city ? `${city} time` : timeZone;
}

export function formatDateTimeInZone(
  value: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(date);
  } catch {
    return null;
  }
}
