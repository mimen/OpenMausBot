import type { DatabaseSync } from "node:sqlite";

import type { Json, JsonObject } from "../contracts.ts";
import { messageDatabase } from "../message-db.ts";
import {
  ComponentActionEventSchema,
  parseStoredComponentActionEvent,
  type ComponentActionEvent,
  type Result,
} from "./contract.ts";

type StoredActionRow = { action_id: string; idempotency_key: string; thread_id: string; json: string };
type StoredLedgerRow = { checked: number; updated_at: string };
type SupplementLedgerWriteResult = { changed: boolean; checked: boolean; updatedAt: string };
type BoundedPublicResult = { summary: string; detail?: string };
type TableColumnRow = { name: string };

let initializedDatabase: DatabaseSync | null = null;

function db(): DatabaseSync {
  const database = messageDatabase();
  if (database === initializedDatabase) return database;
  database.exec(`
    CREATE TABLE IF NOT EXISTS component_action_events (
      action_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      status TEXT NOT NULL,
      follow_up_status TEXT NOT NULL DEFAULT 'pending',
      follow_up_attempt INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS component_action_events_thread
      ON component_action_events(thread_id, updated_at);
    CREATE TABLE IF NOT EXISTS component_action_deliveries (
      action_id TEXT NOT NULL,
      provider_cursor TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      turn_id TEXT,
      PRIMARY KEY (action_id, provider_cursor),
      FOREIGN KEY (action_id) REFERENCES component_action_events(action_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS component_action_quarantine (
      action_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      quarantined_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplement_ledger (
      local_date TEXT NOT NULL,
      regimen_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      checked INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (local_date, regimen_version, item_id)
    );
  `);
  // SAFETY: PRAGMA table_info returns one row per declared column with a TEXT name.
  const columns = database.prepare("PRAGMA table_info(component_action_events)").all() as TableColumnRow[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("follow_up_status")) {
    database.exec("ALTER TABLE component_action_events ADD COLUMN follow_up_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!names.has("follow_up_attempt")) {
    database.exec("ALTER TABLE component_action_events ADD COLUMN follow_up_attempt INTEGER NOT NULL DEFAULT 0");
  }
  database.exec(`
    UPDATE component_action_events
    SET follow_up_status = json_extract(json, '$.followUp.status'),
        follow_up_attempt = json_extract(json, '$.followUp.attempt')
    WHERE json_valid(json)
      AND json_extract(json, '$.followUp.status') IN ('pending', 'claimed', 'dispatched', 'failed')
      AND json_type(json, '$.followUp.attempt') = 'integer';
    CREATE INDEX IF NOT EXISTS component_action_followups
      ON component_action_events(status, follow_up_status, follow_up_attempt, updated_at);
  `);
  initializedDatabase = database;
  return database;
}

function deliveryCursors(actionId: string): ComponentActionEvent["deliveryCursors"] {
  // SAFETY: this query selects the declared TEXT columns from component_action_deliveries.
  const rows = db()
    .prepare("SELECT provider_cursor, delivered_at, turn_id FROM component_action_deliveries WHERE action_id = ? ORDER BY rowid DESC LIMIT ?")
    .all(actionId, 24) as Array<{ provider_cursor: string; delivered_at: string; turn_id: string | null }>;
  return Object.fromEntries(rows.map((row) => {
    const delivery: ComponentActionEvent["deliveryCursors"][string] = { deliveredAt: row.delivered_at };
    if (row.turn_id) delivery.turnId = row.turn_id;
    return [row.provider_cursor, delivery];
  }));
}

function quarantine(row: StoredActionRow, reason: string): void {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(
      "INSERT OR REPLACE INTO component_action_quarantine (action_id, idempotency_key, thread_id, quarantined_at, reason, raw_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(row.action_id, row.idempotency_key, row.thread_id, new Date().toISOString(), reason, row.json);
    database.prepare("DELETE FROM component_action_deliveries WHERE action_id = ?").run(row.action_id);
    database.prepare("DELETE FROM component_action_events WHERE action_id = ?").run(row.action_id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function decode(row: StoredActionRow): ComponentActionEvent | null {
  let raw: Json;
  try {
    raw = JSON.parse(row.json);
  } catch {
    quarantine(row, "invalid JSON");
    return null;
  }
  const parsed = parseStoredComponentActionEvent(raw);
  if (!parsed.ok) {
    quarantine(row, parsed.error);
    return null;
  }
  const withDelivery = ComponentActionEventSchema.safeParse({
    ...parsed.value,
    deliveryCursors: deliveryCursors(parsed.value.actionId),
  });
  if (!withDelivery.success) {
    quarantine(row, "delivery cursor data is malformed");
    return null;
  }
  return withDelivery.data;
}

function storedRowByActionId(actionId: string): StoredActionRow | null {
  // SAFETY: this query aliases only non-null TEXT columns declared in open().
  const row = db()
    .prepare("SELECT action_id, idempotency_key, thread_id, json FROM component_action_events WHERE action_id = ?")
    .get(actionId) as StoredActionRow | undefined;
  return row ?? null;
}

function storedRowByIdempotencyKey(idempotencyKey: string): StoredActionRow | null {
  // SAFETY: this query aliases only non-null TEXT columns declared in open().
  const row = db()
    .prepare("SELECT action_id, idempotency_key, thread_id, json FROM component_action_events WHERE idempotency_key = ?")
    .get(idempotencyKey) as StoredActionRow | undefined;
  return row ?? null;
}

function quarantinedIdempotencyKey(idempotencyKey: string): boolean {
  // SAFETY: this existence probe reads a constant from a table declared in db().
  const row = db().prepare("SELECT 1 AS found FROM component_action_quarantine WHERE idempotency_key = ?")
    .get(idempotencyKey) as { found: number } | undefined;
  return row?.found === 1;
}

export type NewComponentActionEvent = Omit<ComponentActionEvent, "deliveryCursors" | "execution" | "followUp"> & {
  execution?: ComponentActionEvent["execution"];
  followUp?: ComponentActionEvent["followUp"];
};

export function createOrGetActionEvent(input: NewComponentActionEvent): Result<{ event: ComponentActionEvent; created: boolean }, string> {
  if (quarantinedIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, error: "This action is quarantined and cannot be repeated automatically." };
  }
  const event: ComponentActionEvent = {
    ...input,
    deliveryCursors: {},
    execution: input.execution ?? { attempt: input.status === "started" ? 1 : 0 },
    followUp: input.followUp ?? { status: input.status === "started" ? "failed" : "pending", attempt: 0 },
  };
  const parsed = ComponentActionEventSchema.safeParse(event);
  if (!parsed.success) return { ok: false, error: "Component action event exceeded its public bounds." };
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = storedRowByIdempotencyKey(parsed.data.idempotencyKey);
    if (existing) {
      database.exec("COMMIT");
      const decoded = decode(existing);
      return decoded
        ? { ok: true, value: { event: decoded, created: false } }
        : { ok: false, error: "The existing component action event was quarantined." };
    }
    database.prepare(
      "INSERT INTO component_action_events (action_id, idempotency_key, thread_id, call_id, status, follow_up_status, follow_up_attempt, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      parsed.data.actionId,
      parsed.data.idempotencyKey,
      parsed.data.threadId,
      parsed.data.callId,
      parsed.data.status,
      parsed.data.followUp.status,
      parsed.data.followUp.attempt,
      parsed.data.updatedAt,
      JSON.stringify(parsed.data),
    );
    database.exec("COMMIT");
    return { ok: true, value: { event: parsed.data, created: true } };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function claimActionExecution(
  input: NewComponentActionEvent,
  now: Date,
  leaseMs = 30_000,
  options: { allowVerifiedRetry?: boolean } = {},
): Result<{ event: ComponentActionEvent; claimed: boolean; reason?: string }, string> {
  if (quarantinedIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, error: "This action is quarantined and cannot be repeated automatically." };
  }
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const existingRow = storedRowByIdempotencyKey(input.idempotencyKey);
    if (!existingRow) {
      const event = ComponentActionEventSchema.safeParse({
        ...input,
        status: "started",
        updatedAt: now.toISOString(),
        deliveryCursors: {},
        execution: { attempt: 1, leaseUntil: new Date(now.getTime() + leaseMs).toISOString() },
        followUp: { status: "failed", attempt: 0, error: "The action has not completed yet." },
      });
      if (!event.success) {
        database.exec("ROLLBACK");
        return { ok: false, error: "Component action claim exceeded its public bounds." };
      }
      database.prepare(
        "INSERT INTO component_action_events (action_id, idempotency_key, thread_id, call_id, status, follow_up_status, follow_up_attempt, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        event.data.actionId,
        event.data.idempotencyKey,
        event.data.threadId,
        event.data.callId,
        event.data.status,
        event.data.followUp.status,
        event.data.followUp.attempt,
        event.data.updatedAt,
        JSON.stringify(event.data),
      );
      database.exec("COMMIT");
      return { ok: true, value: { event: event.data, claimed: true } };
    }
    let raw: Json;
    try {
      raw = JSON.parse(existingRow.json);
    } catch {
      database.exec("ROLLBACK");
      quarantine(existingRow, "invalid JSON during action claim");
      return { ok: false, error: "The existing component action event was quarantined." };
    }
    const parsed = ComponentActionEventSchema.safeParse(raw);
    if (!parsed.success) {
      database.exec("ROLLBACK");
      quarantine(existingRow, "malformed event during action claim");
      return { ok: false, error: "The existing component action event was quarantined." };
    }
    const current = parsed.data;
    const leaseExpired = (current.status === "started" || current.status === "failed") && (
      !current.execution.leaseUntil || Date.parse(current.execution.leaseUntil) <= now.getTime()
    );
    if (leaseExpired && options.allowVerifiedRetry) {
      const next = ComponentActionEventSchema.parse({
        ...current,
        status: "started",
        trustedOrigin: input.trustedOrigin,
        result: input.result,
        updatedAt: now.toISOString(),
        execution: {
          attempt: current.execution.attempt + 1,
          leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
        },
      });
      database.prepare("UPDATE component_action_events SET status = ?, updated_at = ?, json = ? WHERE action_id = ?")
        .run(next.status, next.updatedAt, JSON.stringify(next), next.actionId);
      database.exec("COMMIT");
      return { ok: true, value: { event: next, claimed: true } };
    }
    database.exec("COMMIT");
    const reason = current.status === "succeeded"
      ? "This action already succeeded."
      : current.status === "failed"
        ? `This action is in a safety window${current.execution.leaseUntil ? ` until ${current.execution.leaseUntil}` : ""}; retry after OpenMaus can verify the remote state.`
        : "This action is already in progress; only read-only recovery may settle it.";
    return { ok: true, value: { event: current, claimed: false, reason } };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function actionEventById(actionId: string): ComponentActionEvent | null {
  const row = storedRowByActionId(actionId);
  return row ? decode(row) : null;
}

export function actionEventByIdempotencyKey(idempotencyKey: string): ComponentActionEvent | null {
  const row = storedRowByIdempotencyKey(idempotencyKey);
  return row ? decode(row) : null;
}

export function updateActionEvent(
  actionId: string,
  patch: Partial<Pick<ComponentActionEvent, "status" | "result" | "updatedAt" | "trustedOrigin" | "execution" | "followUp">>,
): Result<ComponentActionEvent, string> {
  const current = actionEventById(actionId);
  if (!current) return { ok: false, error: "No component action event has that action id." };
  const next = ComponentActionEventSchema.safeParse({ ...current, ...patch });
  if (!next.success) return { ok: false, error: "Component action event update exceeded its public bounds." };
  db().prepare(
    "UPDATE component_action_events SET status = ?, follow_up_status = ?, follow_up_attempt = ?, updated_at = ?, json = ? WHERE action_id = ?",
  ).run(
    next.data.status,
    next.data.followUp.status,
    next.data.followUp.attempt,
    next.data.updatedAt,
    JSON.stringify(next.data),
    actionId,
  );
  return { ok: true, value: next.data };
}

export function actionEventsForThread(threadId: string): ComponentActionEvent[] {
  // SAFETY: this query selects only non-null TEXT columns declared in open().
  const rows = db()
    .prepare("SELECT action_id, idempotency_key, thread_id, json FROM component_action_events WHERE thread_id = ? ORDER BY rowid")
    .all(threadId) as StoredActionRow[];
  return rows.flatMap((row) => {
    const event = decode(row);
    return event ? [event] : [];
  });
}

export function recentActionEventsForThread(threadId: string, limit = 100): ComponentActionEvent[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  // SAFETY: this query selects only non-null TEXT columns declared in db().
  const rows = db().prepare(
    "SELECT action_id, idempotency_key, thread_id, json FROM component_action_events WHERE thread_id = ? ORDER BY rowid DESC LIMIT ?",
  ).all(threadId, boundedLimit) as StoredActionRow[];
  return rows.reverse().flatMap((row) => {
    const event = decode(row);
    return event ? [event] : [];
  });
}

export function allActionEvents(): ComponentActionEvent[] {
  // SAFETY: this query selects only non-null TEXT columns declared in open().
  const rows = db()
    .prepare("SELECT action_id, idempotency_key, thread_id, json FROM component_action_events ORDER BY rowid")
    .all() as StoredActionRow[];
  return rows.flatMap((row) => {
    const event = decode(row);
    return event ? [event] : [];
  });
}

export function pendingActionFollowUps(limit = 100): ComponentActionEvent[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  // SAFETY: this query selects only non-null TEXT columns declared in db().
  const rows = db().prepare(
    "SELECT action_id, idempotency_key, thread_id, json FROM component_action_events " +
      "WHERE status <> 'started' AND follow_up_status <> 'dispatched' " +
      "AND (follow_up_attempt < 3 OR follow_up_status = 'claimed') " +
      "ORDER BY rowid DESC LIMIT ?",
  ).all(boundedLimit) as StoredActionRow[];
  return rows.flatMap((row) => {
    const event = decode(row);
    return event ? [event] : [];
  });
}

export function unreadActionEvents(threadId: string, providerCursor: string): ComponentActionEvent[] {
  // SAFETY: the selected columns are non-null TEXT columns from component_action_events.
  const rows = db().prepare(
    "SELECT e.action_id, e.idempotency_key, e.thread_id, e.json FROM component_action_events e " +
      "LEFT JOIN component_action_deliveries d ON d.action_id = e.action_id AND d.provider_cursor = ? " +
      "WHERE e.thread_id = ? AND e.status <> 'started' AND d.action_id IS NULL ORDER BY e.rowid DESC LIMIT 24",
  ).all(providerCursor, threadId) as StoredActionRow[];
  return rows.reverse().flatMap((row) => {
    const event = decode(row);
    return event ? [event] : [];
  });
}

export function markActionEventsDelivered(
  actionIds: string[],
  providerCursor: string,
  deliveredAt: string,
  turnId?: string,
): void {
  if (actionIds.length === 0) return;
  const database = db();
  const insert = database.prepare(
    "INSERT OR IGNORE INTO component_action_deliveries (action_id, provider_cursor, delivered_at, turn_id) VALUES (?, ?, ?, ?)",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const actionId of actionIds) {
      insert.run(actionId, providerCursor, deliveredAt, turnId ?? null);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function claimFollowUp(actionId: string, now: Date, leaseMs = 30_000): ComponentActionEvent | null {
  const current = actionEventById(actionId);
  if (!current || current.status === "started" || current.followUp.status === "dispatched") return null;
  const claimIsLive = current.followUp.status === "claimed" &&
    current.followUp.claimedUntil !== undefined &&
    Date.parse(current.followUp.claimedUntil) > now.getTime();
  if (claimIsLive) return null;
  if (current.followUp.attempt >= 3) {
    if (current.followUp.status === "claimed") {
      updateActionEvent(actionId, {
        updatedAt: now.toISOString(),
        followUp: {
          status: "failed",
          attempt: current.followUp.attempt,
          error: "The final follow-up claim expired before a provider turn succeeded.",
        },
      });
    }
    return null;
  }
  const updated = updateActionEvent(actionId, {
    updatedAt: now.toISOString(),
    followUp: {
      status: "claimed",
      attempt: current.followUp.attempt + 1,
      claimedUntil: new Date(now.getTime() + leaseMs).toISOString(),
    },
  });
  return updated.ok ? updated.value : null;
}

export function releaseFollowUp(actionId: string, now: Date, error: string): void {
  const current = actionEventById(actionId);
  if (!current) return;
  updateActionEvent(actionId, {
    updatedAt: now.toISOString(),
    followUp: { status: "failed", attempt: current.followUp.attempt, error: error.slice(0, 2_000) },
  });
}

export function markFollowUpDispatched(actionId: string, now: Date): void {
  const current = actionEventById(actionId);
  if (!current) return;
  updateActionEvent(actionId, {
    updatedAt: now.toISOString(),
    followUp: { status: "dispatched", attempt: current.followUp.attempt, dispatchedAt: now.toISOString() },
  });
}

export function deleteActionEventsForThread(threadId: string): void {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(
      "DELETE FROM component_action_deliveries WHERE action_id IN (SELECT action_id FROM component_action_events WHERE thread_id = ?)",
    ).run(threadId);
    database.prepare("DELETE FROM component_action_events WHERE thread_id = ?").run(threadId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function readSupplementLedger(localDate: string, regimenVersion: string): ReadonlyMap<string, boolean> {
  // SAFETY: this query selects the declared item_id TEXT and checked INTEGER columns.
  const rows = db()
    .prepare("SELECT item_id, checked FROM supplement_ledger WHERE local_date = ? AND regimen_version = ?")
    .all(localDate, regimenVersion) as Array<{ item_id: string; checked: number }>;
  return new Map(rows.map((row) => [row.item_id, row.checked === 1]));
}

export function writeSupplementLedger(input: {
  localDate: string;
  regimenVersion: string;
  itemId: string;
  checked: boolean;
  updatedAt: string;
}): SupplementLedgerWriteResult {
  // SAFETY: this query selects the declared checked INTEGER and updated_at TEXT columns.
  const existing = db().prepare(
    "SELECT checked, updated_at FROM supplement_ledger WHERE local_date = ? AND regimen_version = ? AND item_id = ?",
  ).get(input.localDate, input.regimenVersion, input.itemId) as StoredLedgerRow | undefined;
  if (existing?.checked === Number(input.checked)) {
    return { changed: false, checked: input.checked, updatedAt: existing.updated_at };
  }
  db().prepare(
    "INSERT INTO supplement_ledger (local_date, regimen_version, item_id, checked, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(local_date, regimen_version, item_id) DO UPDATE SET checked = excluded.checked, updated_at = excluded.updated_at",
  ).run(input.localDate, input.regimenVersion, input.itemId, Number(input.checked), input.updatedAt);
  return { changed: true, checked: input.checked, updatedAt: input.updatedAt };
}

export function closeActionDb(): void {
  initializedDatabase = null;
}

export function publicActionEvent(event: ComponentActionEvent): ComponentActionEvent {
  return ComponentActionEventSchema.parse(event);
}

export function boundedActionResult(summary: string, detail?: string): JsonObject {
  const result: BoundedPublicResult = { summary: summary.slice(0, 2_000) };
  if (detail) result.detail = detail.slice(0, 2_000);
  return result;
}
