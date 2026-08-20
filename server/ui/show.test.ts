import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { JsonObject, RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import type { TodoistTaskView } from "./contract.ts";
import { readUiActions } from "./evidence.ts";
import { authorizeTodoistCompletion, reconcileTodoistCompletion, showComponent, type ShowStore } from "./show.ts";
import type { TodoistClient } from "./todoist.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memoryStore(): ShowStore & { threads: Map<string, Message[]> } {
  const threads = new Map<string, Message[]>();
  let n = 0;
  return {
    threads,
    appendMessage(threadId, message) {
      const full: Message = { id: `m${++n}`, at: Date.now(), parentId: null, ...message };
      const list = threads.get(threadId) ?? [];
      list.push(full);
      threads.set(threadId, list);
      return full;
    },
    messagesFor(threadId) {
      return threads.get(threadId) ?? [];
    },
    patchMessage(threadId, messageId, patch) {
      const list = threads.get(threadId) ?? [];
      const idx = list.findIndex((row) => row.id === messageId);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...patch };
      return list[idx];
    },
  };
}

function fakeTodoist(tasks: Map<string, TodoistTaskView>): TodoistClient {
  return {
    async getTask(taskId) {
      const task = tasks.get(taskId);
      if (!task) return { ok: false, error: `missing ${taskId}` };
      return { ok: true, value: task };
    },
    async closeTask() {
      throw new Error("server completion must never call Todoist close");
    },
  };
}

const origin = {
  provider: "claudeAgent",
  providerInstanceId: "claude",
  turnId: "turn-1",
  itemId: "toolu-1",
  providerCallId: "rpc-1",
} as const;

describe("showComponent / Todoist desktop authorization", () => {
  it("persists provider-native call identity and never talks to Todoist for an ordinary card", async () => {
    const store = memoryStore();
    const events: RuntimeEvent[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const shown = await showComponent(
      {
        threadId: "t1",
        name: "show_record_card",
        arguments: { title: "Order", fields: [{ label: "Total", value: "$12" }] },
        origin,
      },
      { store, publish: (event) => events.push(event), dataDir, todoist: fakeTodoist(new Map()) },
    );
    expect(shown.ok).toBe(true);
    expect(shown.ok && shown.value.origin).toEqual(origin);
    expect(store.messagesFor("t1")[0]?.component).not.toHaveProperty("actionToken");
    expect(events[0]).toMatchObject({
      type: "component.shown",
      provider: "claudeAgent",
      itemId: "toolu-1",
      name: "show_record_card",
    });
    expect(readUiActions(dataDir)[0]).toMatchObject({ origin });
  });

  it("rejects aggregate component output above the transcript byte limit", async () => {
    const store = memoryStore();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const shown = await showComponent(
      {
        threadId: "t1",
        name: "show_checklist",
        arguments: {
          title: "Oversized",
          items: Array.from({ length: 100 }, (_, index) => ({
            text: `${index}-${"x".repeat(1_999)}`.slice(0, 2_000),
            done: false,
          })),
        },
        origin,
      },
      { store, publish: () => {}, dataDir, todoist: fakeTodoist(new Map()) },
    );
    expect(shown).toEqual({ ok: false, error: "Component output exceeded the safe transcript limits." });
    expect(store.messagesFor("t1")).toEqual([]);
  });

  it("loads Todoist rows on show and does not complete them", async () => {
    const store = memoryStore();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const tasks = new Map<string, TodoistTaskView>([
      ["6hJCfm66Hh5Q4wqv", { id: "6hJCfm66Hh5Q4wqv", content: "Complete me from component A", isCompleted: false, url: null, due: null }],
    ]);
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { title: "Test", taskIds: ["6hJCfm66Hh5Q4wqv"] }, origin },
      { store, publish: () => {}, dataDir, todoist: fakeTodoist(tasks) },
    );
    expect(shown.ok).toBe(true);
    if (!shown.ok) throw new Error(shown.error);
    const args: JsonObject = shown.value.arguments;
    expect(args.tasks).toEqual([
      { id: "6hJCfm66Hh5Q4wqv", content: "Complete me from component A", isCompleted: false, url: null, due: null, unavailable: false },
    ]);
  });

  it("authorizes only an exact shown task, then records Electron's completed write", async () => {
    const store = memoryStore();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const taskId = "6hJCfm66Hh5Q4wqv";
    const tasks = new Map<string, TodoistTaskView>([
      [taskId, { id: taskId, content: "A", isCompleted: false, url: null, due: null }],
    ]);
    const ctx = { store, publish: () => {}, dataDir, todoist: fakeTodoist(tasks) };
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: [taskId] }, origin },
      ctx,
    );
    if (!shown.ok) throw new Error(shown.error);

    await expect(authorizeTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId: "nope" }, ctx)).resolves.toMatchObject({ ok: false });
    await expect(authorizeTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId }, ctx)).resolves.toEqual({ ok: true, value: { taskId } });
    // A curl-equivalent reconciliation cannot bypass the trusted Electron
    // close: the remote task must already report completed.
    await expect(reconcileTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId }, ctx)).resolves.toMatchObject({
      ok: false,
      error: "Todoist has not confirmed this task as completed.",
    });
    tasks.set(taskId, { id: taskId, content: "A", isCompleted: true, url: null, due: null });
    await expect(reconcileTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId }, ctx)).resolves.toEqual({ ok: true, value: { taskId } });
    expect(shown.value).not.toHaveProperty("actionToken");
    expect(store.messagesFor("t1")[0]?.component?.arguments).toMatchObject({
      tasks: [{ id: taskId, isCompleted: true }],
    });
    expect(readUiActions(dataDir).some((row) => row.kind === "complete-accepted")).toBe(false);
    await expect(reconcileTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId }, ctx)).resolves.toEqual({
      ok: true,
      value: { taskId },
    });
  });

  it("reconciles an already-closed remote task without attempting a close", async () => {
    const store = memoryStore();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const taskId = "closed-task";
    const tasks = new Map<string, TodoistTaskView>([
      [taskId, { id: taskId, content: "A", isCompleted: false, url: null, due: null }],
    ]);
    const ctx = { store, publish: () => {}, dataDir, todoist: fakeTodoist(tasks) };
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: [taskId] }, origin },
      ctx,
    );
    if (!shown.ok) throw new Error(shown.error);
    tasks.set(taskId, { id: taskId, content: "A", isCompleted: true, url: null, due: null });
    const result = await authorizeTodoistCompletion({ threadId: "t1", callId: shown.value.callId, taskId }, ctx);
    expect(result).toMatchObject({ ok: false, error: "That task is already completed in Todoist." });
    expect(store.messagesFor("t1")[0]?.component?.arguments).toMatchObject({ tasks: [{ isCompleted: true }] });
  });
});
