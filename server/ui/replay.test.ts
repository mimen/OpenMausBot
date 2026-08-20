import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR, ensureDirs } from "../config.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { closeMessageDb, readThread } from "../message-db.ts";
import { Store } from "../store.ts";
import { UiCallCorrelation } from "./correlation.ts";
import { readUiActions } from "./evidence.ts";
import { parseStoredComponentCall, type Json, type TodoistTaskView } from "./contract.ts";
import { reconcileTodoistCompletion, showComponent } from "./show.ts";
import type { TodoistClient } from "./todoist.ts";

const TASK_A = "6hJCfm66Hh5Q4wqv";
const TASK_B = "6hJCfmGxJHcvjQRM";

function fakeTodoist(tasks: ReadonlyMap<string, TodoistTaskView>): TodoistClient {
  return {
    async getTask(taskId) {
      const task = tasks.get(taskId);
      return task ? { ok: true, value: task } : { ok: false, error: `missing ${taskId}` };
    },
    async closeTask() {
      throw new Error("server must not close Todoist");
    },
  };
}

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  ensureDirs();
});

afterEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

function uiStart(provider: string, threadId: string, itemId: string): RuntimeEvent {
  return {
    eventId: `event-${itemId}`,
    provider,
    providerInstanceId: `${provider}-instance`,
    threadId,
    createdAt: "2026-08-20T12:00:00.000Z",
    turnId: `turn-${provider}`,
    itemId,
    type: "item.started",
    itemType: "tool",
    title: "mcp__ui__show_todoist_tasks",
    arguments: { title: provider, taskIds: [TASK_A, TASK_B] },
  };
}

describe("component transcript replay", () => {
  it.each(["claudeAgent", "codex", "grokAcp", "antigravityAgent"])(
    "correlates %s provider identity through SQLite restart replay",
    async (provider) => {
      const tasks = new Map<string, TodoistTaskView>([
        [TASK_A, { id: TASK_A, content: "Task A", isCompleted: false, url: null, due: null }],
        [TASK_B, { id: TASK_B, content: "Task B", isCompleted: false, url: null, due: null }],
      ]);
      const store = new Store(() => ({ instanceId: provider, model: "test" }));
      const bot = store.createBot({ name: provider }, { seedMessages: false });
      const correlation = new UiCallCorrelation();
      const itemId = `item-${provider}`;
      correlation.record(uiStart(provider, bot.threadId, itemId));
      const origin = await correlation.claim({
        threadId: bot.threadId,
        name: "show_todoist_tasks",
        arguments: { title: provider, taskIds: [TASK_A, TASK_B] },
        provider,
        providerInstanceId: `${provider}-instance`,
        providerCallId: `rpc-${provider}`,
      });
      const context = { store, publish: () => {}, dataDir: DATA_DIR, todoist: fakeTodoist(tasks) };
      const shown = await showComponent(
        { threadId: bot.threadId, name: "show_todoist_tasks", arguments: { title: provider, taskIds: [TASK_A, TASK_B] }, origin },
        context,
      );
      if (!shown.ok) throw new Error(shown.error);
      expect(readUiActions(DATA_DIR).find((row) => row.kind === "shown")?.origin).toMatchObject({
        provider,
        providerInstanceId: `${provider}-instance`,
        turnId: `turn-${provider}`,
        itemId,
        providerCallId: `rpc-${provider}`,
      });
      tasks.set(TASK_A, { id: TASK_A, content: "Task A", isCompleted: true, url: null, due: null });
      expect((await reconcileTodoistCompletion({ threadId: bot.threadId, callId: shown.value.callId, taskId: TASK_A }, context)).ok).toBe(true);

      closeMessageDb();
      const restarted = new Store(() => ({ instanceId: provider, model: "test" }));
      const replayed = restarted.messagesFor(bot.threadId).find((message) => message.kind === "component")?.component;
      expect(replayed).toMatchObject({
        callId: shown.value.callId,
        name: "show_todoist_tasks",
        origin: {
          provider,
          providerInstanceId: `${provider}-instance`,
          turnId: `turn-${provider}`,
          itemId,
          providerCallId: `rpc-${provider}`,
        },
        arguments: {
          tasks: [
            { id: TASK_A, isCompleted: true },
            { id: TASK_B, isCompleted: false },
          ],
        },
      });
      expect(replayed).not.toHaveProperty("actionToken");
    },
  );

  it("strips a legacy completion token from the SQLite row during replay", () => {
    const store = new Store(() => ({ instanceId: "claude", model: "test" }));
    const bot = store.createBot({ name: "Legacy" }, { seedMessages: false });
    const message = store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: "placeholder",
    });
    closeMessageDb();
    const database = new DatabaseSync(`${DATA_DIR}/messages.db`);
    const legacy = {
      id: message.id,
      at: message.at,
      parentId: message.parentId,
      role: "bot",
      kind: "component",
      component: {
        callId: "legacy-call",
        name: "show_checklist",
        arguments: { title: "Legacy", items: [] },
        result: "shown",
        status: "shown",
        actionToken: "ombui_must_disappear",
      },
    };
    database.prepare("UPDATE messages SET kind = 'component', json = ? WHERE thread_id = ? AND id = ?")
      .run(JSON.stringify(legacy), bot.threadId, message.id);
    database.close();

    const restarted = new Store(() => ({ instanceId: "claude", model: "test" }));
    const replayed = restarted.messagesFor(bot.threadId)[0]?.component;
    expect(replayed).toMatchObject({ callId: "legacy-call", origin: { provider: "legacy" } });
    expect(replayed).not.toHaveProperty("actionToken");
    closeMessageDb();
    const checked = new DatabaseSync(`${DATA_DIR}/messages.db`);
    // SAFETY: this test query selects the non-null TEXT json column only.
    const row = checked.prepare("SELECT json FROM messages WHERE thread_id = ? AND id = ?").get(bot.threadId, message.id) as { json: string };
    checked.close();
    expect(row.json).not.toContain("ombui_must_disappear");
    expect(row.json).not.toContain("actionToken");
  });

  it("rejects deeply nested stored arguments without throwing", () => {
    let nested: Json = "leaf";
    for (let depth = 0; depth < 3_000; depth++) nested = [nested];
    expect(parseStoredComponentCall({
      callId: "deep",
      name: "show_record_card",
      arguments: { nested },
      result: "shown",
      status: "shown",
      origin: { provider: "test" },
    })).toMatchObject({ ok: false });
  });

  it("skips malformed legacy transcript envelopes instead of throwing", () => {
    const legacyFile = join(DATA_DIR, "messages-legacy.json");
    writeFileSync(legacyFile, JSON.stringify({ messages: [null, "bad", { id: 42 }] }));
    expect(readThread("legacy", legacyFile)).toEqual({ messages: [], activeLeafId: null });
  });

  it("quarantines malformed stored component calls instead of throwing", () => {
    const store = new Store(() => ({ instanceId: "claude", model: "test" }));
    const bot = store.createBot({ name: "Malformed" }, { seedMessages: false });
    const message = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "placeholder" });
    closeMessageDb();
    const database = new DatabaseSync(`${DATA_DIR}/messages.db`);
    const malformed = {
      id: message.id,
      at: message.at,
      role: "bot",
      kind: "component",
      component: { callId: 42, arguments: Array.from({ length: 1_000 }, () => "bad") },
    };
    database.prepare("UPDATE messages SET kind = 'component', json = ? WHERE thread_id = ? AND id = ?")
      .run(JSON.stringify(malformed), bot.threadId, message.id);
    database.close();

    const restarted = new Store(() => ({ instanceId: "claude", model: "test" }));
    expect(restarted.messagesFor(bot.threadId)[0]?.component).toMatchObject({
      name: "Stored component",
      status: "error",
      origin: { provider: "quarantine" },
    });
  });
});
