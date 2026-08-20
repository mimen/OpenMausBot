import type { GallerySpec } from "./contract.ts";

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
        title: { type: "string", description: "What this record is, e.g. a person or an order" },
        subtitle: { type: "string", description: "One line of context under the title" },
        status: { type: "string", description: "A short status word, e.g. Approved" },
        statusTone: tone,
        fields: {
          type: "array",
          description: "The fields, in the order they should be read",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "string", description: "Already formatted for a person to read" },
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
        title: { type: "string", description: "What these figures are about" },
        caption: { type: "string" },
        metrics: {
          type: "array",
          maxItems: 6,
          description: "Up to six figures. More than that wanted a table.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "string", description: "Already formatted, including any unit or currency" },
              change: { type: "string", description: "The movement, e.g. '+12% on last month'" },
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
        title: { type: "string", description: "What this list is" },
        caption: { type: "string" },
        items: {
          type: "array",
          description: "The items, in the order they should be done",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "done"],
            properties: {
              text: { type: "string" },
              done: { type: "boolean", description: "Whether this one is already finished" },
              note: { type: "string", description: "A short aside, e.g. who it is waiting on" },
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
        quote: { type: "string", description: "The quotation itself, without surrounding quote marks" },
        attribution: {
          type: "string",
          description: "Who said or wrote it, e.g. 'Grace Hopper' or 'the 2026 annual report'",
        },
        context: {
          type: "string",
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
        title: { type: "string", description: "What this list is, e.g. Today's tasks" },
        taskIds: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          description: "One to 25 exact Todoist task IDs to display. IDs must match the tasks exactly, with no surrounding whitespace.",
          items: { type: "string" },
        },
      },
    },
    confirmation:
      "The Todoist tasks are now on screen for the person. Completing a task requires them to click; showing them did not complete anything.",
  },
];

export const GALLERY_BY_NAME: ReadonlyMap<string, GallerySpec> = new Map(GALLERY.map((spec) => [spec.name, spec]));

export const UI_TOOL_NAMES: ReadonlySet<string> = new Set(GALLERY.map((spec) => spec.name));

export function isUiToolTitle(title: string | undefined): boolean {
  if (!title) return false;
  if (UI_TOOL_NAMES.has(title)) return true;
  const bare = title.includes("__") ? title.slice(title.lastIndexOf("__") + 2) : title;
  return title.includes("mcp__ui__") || UI_TOOL_NAMES.has(bare);
}
