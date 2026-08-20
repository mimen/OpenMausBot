import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR, ensureDirs } from "../config.ts";
import { closeMessageDb } from "../message-db.ts";
import {
  actionEventsForThread,
  claimFollowUp,
  closeActionDb,
  createOrGetActionEvent,
  markActionEventsDelivered,
  markFollowUpDispatched,
  readSupplementLedger,
  unreadActionEvents,
  writeSupplementLedger,
} from "./action-db.ts";

const BASE_EVENT = {
  actionId: "action-1",
  idempotencyKey: "component:thread:call:action:entity",
  threadId: "thread-action",
  callId: "call-1",
  botId: "bot-1",
  componentName: "show_supplement_stack",
  actionName: "tick_item",
  entity: { id: "magnesium", label: "Magnesium" },
  result: { summary: "Checked Magnesium." },
  status: "succeeded" as const,
  trustedOrigin: "same_origin_browser" as const,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

beforeEach(() => {
  closeActionDb();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  ensureDirs();
});

describe("component action SQLite store", () => {
  it("persists one public event and tracks delivery independently per provider cursor", () => {
    const created = createOrGetActionEvent(BASE_EVENT);
    expect(created).toMatchObject({ ok: true, value: { created: true } });
    expect(unreadActionEvents(BASE_EVENT.threadId, "claude:one")).toHaveLength(1);

    markActionEventsDelivered([BASE_EVENT.actionId], "claude:one", "2026-08-20T12:01:00.000Z", "turn-1");
    expect(unreadActionEvents(BASE_EVENT.threadId, "claude:one")).toEqual([]);
    expect(unreadActionEvents(BASE_EVENT.threadId, "codex:two")).toHaveLength(1);
    const publicJson = JSON.stringify(actionEventsForThread(BASE_EVENT.threadId));
    expect(publicJson).not.toContain("OMB_DESKTOP_ACTION_TOKEN");
    expect(publicJson).not.toContain("OMB_UI_TOKEN");
    expect(publicJson).not.toContain("TODOIST_API_TOKEN");
    expect(publicJson).not.toContain("actionToken");

    closeMessageDb();
    expect(actionEventsForThread(BASE_EVENT.threadId)[0]).toMatchObject({
      actionId: BASE_EVENT.actionId,
      deliveryCursors: { "claude:one": { turnId: "turn-1" } },
    });
  });

  it("bounds provider delivery cursors without quarantining a healthy event", () => {
    expect(createOrGetActionEvent(BASE_EVENT).ok).toBe(true);
    for (let index = 0; index < 30; index += 1) {
      markActionEventsDelivered([BASE_EVENT.actionId], `provider:${index}`, `2026-08-20T12:${String(index).padStart(2, "0")}:00.000Z`);
    }
    const [event] = actionEventsForThread(BASE_EVENT.threadId);
    expect(Object.keys(event.deliveryCursors)).toHaveLength(24);
    expect(event.actionId).toBe(BASE_EVENT.actionId);
    closeMessageDb();
    const database = new DatabaseSync(`${DATA_DIR}/messages.db`);
    // SAFETY: this test query selects a COUNT aggregate for one action id.
    const row = database.prepare("SELECT COUNT(*) AS count FROM component_action_deliveries WHERE action_id = ?")
      .get(BASE_EVENT.actionId) as { count: number };
    database.close();
    expect(row.count).toBe(30);
  });

  it("bounds each provider-context delivery batch to the 24 newest unread events", () => {
    for (let index = 0; index < 30; index += 1) {
      const created = createOrGetActionEvent({
        ...BASE_EVENT,
        actionId: `action-${index}`,
        idempotencyKey: `key-${index}`,
        updatedAt: `2026-08-20T12:${String(index).padStart(2, "0")}:00.000Z`,
      });
      expect(created.ok).toBe(true);
    }
    const unread = unreadActionEvents(BASE_EVENT.threadId, "new-provider:one");
    expect(unread).toHaveLength(24);
    expect(unread[0]?.actionId).toBe("action-6");
    expect(unread.at(-1)?.actionId).toBe("action-29");
  });

  it("quarantines malformed replay while tombstoning its idempotency key", () => {
    expect(createOrGetActionEvent(BASE_EVENT).ok).toBe(true);
    closeMessageDb();
    const database = new DatabaseSync(`${DATA_DIR}/messages.db`);
    database.prepare("UPDATE component_action_events SET json = ? WHERE action_id = ?")
      .run("{bad", BASE_EVENT.actionId);
    database.close();
    closeMessageDb();

    expect(actionEventsForThread(BASE_EVENT.threadId)).toEqual([]);
    expect(createOrGetActionEvent(BASE_EVENT)).toEqual({
      ok: false,
      error: "This action is quarantined and cannot be repeated automatically.",
    });
    closeMessageDb();
    const checked = new DatabaseSync(`${DATA_DIR}/messages.db`);
    // SAFETY: this test query selects the quarantine tombstone's declared TEXT column.
    const row = checked.prepare("SELECT idempotency_key FROM component_action_quarantine WHERE action_id = ?")
      .get(BASE_EVENT.actionId) as { idempotency_key: string };
    checked.close();
    expect(row.idempotency_key).toBe(BASE_EVENT.idempotencyKey);
  });

  it("claims a terminal follow-up once and caps failed dispatch attempts", () => {
    expect(createOrGetActionEvent(BASE_EVENT).ok).toBe(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = claimFollowUp(BASE_EVENT.actionId, new Date(`2026-08-20T12:0${attempt}:00.000Z`), 1);
      expect(claimed?.followUp.attempt).toBe(attempt + 1);
      if (attempt < 2) {
        const next = actionEventsForThread(BASE_EVENT.threadId)[0];
        const database = new DatabaseSync(`${DATA_DIR}/messages.db`);
        database.prepare("UPDATE component_action_events SET json = ? WHERE action_id = ?")
          .run(JSON.stringify({ ...next, followUp: { status: "failed", attempt: attempt + 1, error: "dispatch failed" } }), BASE_EVENT.actionId);
        database.close();
        closeMessageDb();
      }
    }
    expect(claimFollowUp(BASE_EVENT.actionId, new Date("2026-08-20T13:00:00.000Z"))).toBeNull();
  });

  it("marks dispatched follow-ups terminally", () => {
    expect(createOrGetActionEvent(BASE_EVENT).ok).toBe(true);
    expect(claimFollowUp(BASE_EVENT.actionId, new Date("2026-08-20T12:00:00.000Z"))).toBeTruthy();
    markFollowUpDispatched(BASE_EVENT.actionId, new Date("2026-08-20T12:00:01.000Z"));
    expect(actionEventsForThread(BASE_EVENT.threadId)[0]?.followUp).toMatchObject({ status: "dispatched", attempt: 1 });
  });

  it("persists the dated supplement ledger and makes same-state writes idempotent", () => {
    const first = writeSupplementLedger({
      localDate: "2026-08-20",
      regimenVersion: "v1",
      itemId: "magnesium",
      checked: true,
      updatedAt: "2026-08-20T12:00:00.000Z",
    });
    const duplicate = writeSupplementLedger({
      localDate: "2026-08-20",
      regimenVersion: "v1",
      itemId: "magnesium",
      checked: true,
      updatedAt: "2026-08-20T12:01:00.000Z",
    });
    expect(first.changed).toBe(true);
    expect(duplicate.changed).toBe(false);
    closeMessageDb();
    expect(readSupplementLedger("2026-08-20", "v1").get("magnesium")).toBe(true);
    expect(readSupplementLedger("2026-08-21", "v1").get("magnesium")).toBeUndefined();
  });
});
