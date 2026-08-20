import { UI_LIMITS, type GallerySpec } from "./contract.ts";

const tone = {
  type: "string" as const,
  enum: ["neutral", "positive", "caution", "negative"],
  description:
    "How this reads at a glance. Use negative and caution sparingly, for a refusal, a breach or a failure, not for anything merely notable.",
};

export const GALLERY: GallerySpec[] = [
  {
    name: "show_record_card",
    title: "Record",
    kind: "card",
    description:
      "Show a structured record on screen: a person, an order, a file, anything with labeled fields. Use instead of a markdown table when the person should read one thing at a glance.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "fields"],
      properties: {
        title: { type: "string", maxLength: UI_LIMITS.title, description: "What this record is, e.g. a person or an order" },
        subtitle: { type: "string", maxLength: UI_LIMITS.subtitle, description: "One line of context under the title" },
        status: { type: "string", maxLength: UI_LIMITS.label, description: "A short status word, e.g. Approved" },
        statusTone: tone,
        fields: {
          type: "array",
          description: "The fields, in the order they should be read",
          maxItems: UI_LIMITS.recordRows,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", maxLength: UI_LIMITS.label },
              value: { type: "string", maxLength: UI_LIMITS.value, description: "Already formatted for a person to read" },
            },
          },
        },
      },
    },
    confirmation: "The record is now on screen for the person.",
  },
  {
    name: "show_metrics_card",
    title: "Figures",
    kind: "card",
    description:
      "Show up to six figures with labels. Use when the person should compare numbers, not when a table or a full report is needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "metrics"],
      properties: {
        title: { type: "string", maxLength: UI_LIMITS.title, description: "What these figures are about" },
        caption: { type: "string", maxLength: UI_LIMITS.subtitle },
        metrics: {
          type: "array",
          maxItems: UI_LIMITS.metricsRows,
          description: "Up to six figures. More than that wanted a table.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", maxLength: UI_LIMITS.label },
              value: { type: "string", maxLength: UI_LIMITS.value, description: "Already formatted, including any unit or currency" },
              change: { type: "string", maxLength: UI_LIMITS.subtitle, description: "The movement, e.g. '+12% on last month'" },
              changeTone: tone,
            },
          },
        },
      },
    },
    confirmation: "The figures are now on screen for the person.",
  },
  {
    name: "show_checklist",
    title: "Checklist",
    kind: "list",
    description:
      "Show a read-only checklist. Use for a set of items and whether each is already done. Do not use this for Todoist tasks the person should complete — use show_todoist_tasks for those.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "items"],
      properties: {
        title: { type: "string", maxLength: UI_LIMITS.title, description: "What this list is" },
        caption: { type: "string", maxLength: UI_LIMITS.subtitle },
        items: {
          type: "array",
          description: "The items, in the order they should be done",
          maxItems: UI_LIMITS.checklistRows,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "done"],
            properties: {
              text: { type: "string", maxLength: UI_LIMITS.content },
              done: { type: "boolean", description: "Whether this one is already finished" },
              note: { type: "string", maxLength: UI_LIMITS.subtitle, description: "A short aside, e.g. who it is waiting on" },
            },
          },
        },
      },
    },
    confirmation: "The checklist is now on screen for the person.",
  },
  {
    name: "show_quote",
    title: "Quotation",
    kind: "card",
    description:
      "Show a quotation with its attribution. Use when the exact words matter, something a person said, or a line from a document you were given.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["quote", "attribution"],
      properties: {
        quote: { type: "string", maxLength: UI_LIMITS.value, description: "The quotation itself, without surrounding quote marks" },
        attribution: {
          type: "string",
          maxLength: UI_LIMITS.subtitle,
          description: "Who said or wrote it, e.g. 'Grace Hopper' or 'the 2026 annual report'",
        },
        context: {
          type: "string",
          maxLength: UI_LIMITS.subtitle,
          description: "One short line of context: where it is from, or why it matters here",
        },
      },
    },
    confirmation: "The quotation is now on screen for the person.",
  },
  {
    name: "show_todoist_tasks",
    title: "Todoist tasks",
    kind: "action",
    description:
      "Show real Todoist tasks the person can complete from the component. Pass exact task IDs. Showing the tasks never completes them — the person must click Complete on a row. Use this instead of listing tasks in markdown when they should act on them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["taskIds"],
      properties: {
        title: { type: "string", maxLength: UI_LIMITS.title, description: "What this list is, e.g. Today's tasks" },
        taskIds: {
          type: "array",
          minItems: 1,
          maxItems: UI_LIMITS.todoistRows,
          description: "One to 25 exact Todoist task IDs to display. IDs must match the tasks exactly, with no surrounding whitespace.",
          items: { type: "string", minLength: 1, maxLength: UI_LIMITS.providerIdentity },
        },
      },
    },
    confirmation:
      "The Todoist tasks are now on screen for the person. Completing a task requires them to click; showing them did not complete anything.",
  },
];

export const GALLERY_BY_NAME: ReadonlyMap<string, GallerySpec> = new Map(GALLERY.map((spec) => [spec.name, spec]));

export const UI_TOOL_NAMES: ReadonlySet<string> = new Set(GALLERY.map((spec) => spec.name));

export function uiToolNameFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  if (UI_TOOL_NAMES.has(title)) return title;
  const prefix = "mcp__ui__";
  if (!title.startsWith(prefix)) return null;
  const name = title.slice(prefix.length);
  return UI_TOOL_NAMES.has(name) ? name : null;
}

export function isUiToolTitle(title: string | undefined): boolean {
  return uiToolNameFromTitle(title) !== null;
}
