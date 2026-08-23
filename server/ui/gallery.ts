import type { OpenMausBinding } from "@mimen/generative-ui-pack/openmaus";
import { z } from "zod";

import { UI_LIMITS, type GallerySpec, type Json, type JsonObject, type JsonSchema, type Result } from "./contract.ts";
import { COMPILED_COMPONENT_SCHEMAS } from "./schemas.ts";
import { SHARED_READ_ONLY_BINDINGS } from "./read-only-components.ts";
import { validateArgs } from "./validate.ts";

const LOCAL_GALLERY: Array<Omit<GallerySpec, "validate">> = [
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

const JSON_OBJECT = z.record(z.string(), z.json());

function sharedReadOnlySpec(binding: OpenMausBinding): GallerySpec {
  const adapter = binding.validationAdapter;
  if (
    adapter.kind !== "json-schema-validator"
    || adapter.module !== "server/ui/validate.ts"
    || adapter.exportName !== "validateArgs"
    || adapter.contractVersion !== 1
  ) {
    throw new Error(`Unsupported OpenMaus validation adapter for ${binding.toolName}`);
  }
  const parsedParameters = JSON_OBJECT.parse(binding.parameters);
  // SAFETY: the package's OpenMaus compiler emits the same bounded JsonSchema contract this host exposes to models.
  const parameters = parsedParameters as JsonSchema;
  return {
    name: binding.toolName,
    title: binding.title,
    kind: binding.kind,
    description: binding.description,
    parameters,
    confirmation: binding.confirmation,
    componentId: binding.componentId,
    viewVersion: binding.viewVersion,
    validate: (value) => validateArgs(parameters, value),
  };
}

function compiledSpec(input: {
  name: keyof typeof COMPILED_COMPONENT_SCHEMAS;
  title: string;
  kind: GallerySpec["kind"];
  description: string;
  confirmation: string;
}): GallerySpec {
  const schema = COMPILED_COMPONENT_SCHEMAS[input.name];
  const jsonSchema = JSON_OBJECT.parse(z.toJSONSchema(schema));
  // SAFETY: z.toJSONSchema emitted a JSON object from the same strict Zod schema used by validate below.
  const parameters = jsonSchema as JsonSchema;
  return {
    ...input,
    parameters,
    validate(value: Json): Result<JsonObject, string> {
      const parsed = schema.safeParse(value);
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "component arguments are invalid" };
      const object = JSON_OBJECT.safeParse(parsed.data);
      return object.success
        ? { ok: true, value: object.data }
        : { ok: false, error: "component arguments must be a JSON object" };
    },
  };
}

const COMPILED_GALLERY: GallerySpec[] = [
  compiledSpec({
    name: "show_status_board",
    title: "Status board",
    kind: "list",
    description: "Show decision-ready operational status grouped as resolved, new, awaiting, still open, and healthy. Preserve exact counts, owners, evidence, severity, and next moves; use the quiet state when nothing needs attention.",
    confirmation: "The status board is now on screen.",
  }),
  compiledSpec({
    name: "show_supplement_stack",
    title: "Supplement stack",
    kind: "action",
    description: "Show the dated AM/PM regimen and situational items. The server overlays a per-day local checklist ledger; ticks never edit the regimen source or vault protocol.",
    confirmation: "The dated supplement stack is now on screen.",
  }),
  compiledSpec({
    name: "show_week_calendar",
    title: "Week calendar",
    kind: "list",
    description: "Show exactly seven days of existing, proposed, and conflicting commitments, including field trips, walker assignments, relevant context, exclusions, and reply-ready approval choices. This component proposes only; it never writes Google Calendar.",
    confirmation: "The seven-day calendar proposal is now on screen.",
  }),
  compiledSpec({
    name: "show_supply_status",
    title: "Supply status",
    kind: "card",
    description: "Show a recommendation, bottle counts, filled/incoming/threshold gauge, cost, aging deadline, provenance, and reply choices. This component never changes ReadyRefresh or any supplier account.",
    confirmation: "The supply recommendation is now on screen.",
  }),
  compiledSpec({
    name: "show_conversation",
    title: "Conversation",
    kind: "card",
    description: "Show a bounded recent conversation, surface, age, stakes, owed reason, and a draft. Reply choices may ask to edit or request a claude-actions mint, but this component never sends and never carries messaging credentials.",
    confirmation: "The bounded conversation and draft are now on screen.",
  }),
  compiledSpec({
    name: "show_booking_slot",
    title: "Booking slot",
    kind: "card",
    description: "Show one candidate haircut slot, last-cut age, surrounding calendar fit, and an explicitly unverified Square state. Reply choices approve the exact slot or ask for a different day; this component never opens or books Square.",
    confirmation: "The candidate booking slot is now on screen.",
  }),
  compiledSpec({
    name: "show_event_countdown",
    title: "Event countdown",
    kind: "list",
    description: "Show live time to doors, completed and open blockers, owners, evidence, draft-ready links, and the next move. Use exact timestamps so the renderer owns the countdown.",
    confirmation: "The live event countdown is now on screen.",
  }),
];

export const GALLERY: GallerySpec[] = [
  ...SHARED_READ_ONLY_BINDINGS.map(sharedReadOnlySpec),
  ...LOCAL_GALLERY.map((spec): GallerySpec => ({
    ...spec,
    validate: (value) => validateArgs(spec.parameters, value),
  })),
  ...COMPILED_GALLERY,
];

export const GALLERY_BY_NAME: ReadonlyMap<string, GallerySpec> = new Map(GALLERY.map((spec) => [spec.name, spec]));
export const UI_TOOL_NAMES: ReadonlySet<string> = new Set(GALLERY.map((spec) => spec.name));

export function privateUiTools(): Array<{ name: string; description: string; inputSchema: JsonSchema }> {
  return GALLERY.map((spec) => ({ name: spec.name, description: spec.description, inputSchema: spec.parameters }));
}

export function generativeUiSystemPrompt(): string {
  const tools = GALLERY.map((spec) => `${spec.name} (${spec.title.toLowerCase()})`).join(", ");
  return `You can put structured UI on screen with the private ui tools mounted for this OpenMaus turn. Available tools: ${tools}. Prefer a component over a markdown table or prose list when the person should inspect or act on structured information. Typed fields carry exact facts; you still own relevance, grouping, emphasis, explanation, composition, and the best next step. The mounted tool schemas are the source of truth; never invent a UI tool name or arguments. Showing a component never performs its interactive action — the person must use the trusted control in OpenMausBot.`;
}

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
