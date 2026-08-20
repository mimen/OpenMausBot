import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { redactSecrets } from "../redact.ts";
import { ComponentOriginSchema, type ComponentOrigin } from "./contract.ts";

export type UiActionKind = "shown" | "complete-accepted" | "complete-rejected";

export type UiActionRow = {
  at: string;
  kind: UiActionKind;
  threadId: string;
  callId: string;
  name: string;
  taskId?: string;
  ok: boolean;
  detail: string;
  origin?: ComponentOrigin;
};

const UiAction = z.object({
  at: z.string(),
  kind: z.enum(["shown", "complete-accepted", "complete-rejected"]),
  threadId: z.string(),
  callId: z.string(),
  name: z.string(),
  taskId: z.string().optional(),
  ok: z.boolean(),
  detail: z.string(),
  origin: ComponentOriginSchema.optional(),
});
const FILE_NAME = "ui-actions.ndjson";

export function uiActionsPath(dir: string): string {
  return join(dir, FILE_NAME);
}

export function appendUiAction(dir: string, row: UiActionRow): void {
  try {
    appendFileSync(uiActionsPath(dir), JSON.stringify(redactSecrets(row)) + "\n", { mode: 0o600 });
  } catch {
    /* an audit log must never take down the action it is auditing */
  }
}

export function readUiActions(dir: string): UiActionRow[] {
  try {
    const text = readFileSync(uiActionsPath(dir), "utf8");
    const rows: UiActionRow[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = UiAction.safeParse(JSON.parse(line));
        if (parsed.success) rows.push(parsed.data);
      } catch {
        /* skip a torn line */
      }
    }
    return rows;
  } catch {
    return [];
  }
}
