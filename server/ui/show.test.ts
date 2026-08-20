import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { JsonObject, RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import type { TodoistTaskView } from "./contract.ts";
import { readUiActions } from "./evidence.ts";
import { completeTodoistTask, showComponent, type ShowStore } from "./show.ts";
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

function fakeTodoist(tasks: Map<string, TodoistTaskView>, closed: string[]): TodoistClient {
  return {
    async getTask(taskId) {
      const task = tasks.get(taskId);
      if (!task) return { ok: false, error: `missing ${taskId}` };
      return { ok: true, value: task };
    },
    async closeTask(taskId) {
      if (!tasks.has(taskId)) return { ok: false, error: `missing ${taskId}` };
      closed.push(taskId);
      return { ok: true, value: true };
    },
  };
}

describe("showComponent / completeTodoistTask", () => {
  it("persists a record card and never talks to Todoist", async () => {
    const store = memoryStore();
    const closed: string[] = [];
    const events: RuntimeEvent[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const shown = await showComponent(
      {
        threadId: "t1",
        name: "show_record_card",
        arguments: { title: "Order", fields: [{ label: "Total", value: "$12" }] },
      },
      {
        store,
        publish: (event) => events.push(event),
        dataDir,
        todoist: fakeTodoist(new Map(), closed),
        token: () => "ombui_test",
      },
    );
    expect(shown.ok).toBe(true);
    expect(closed).toEqual([]);
    expect(store.messagesFor("t1")[0]?.kind).toBe("component");
    expect(events[0]).toMatchObject({ type: "component.shown", name: "show_record_card", status: "shown" });
  });

  it("loads real Todoist rows on show and does not complete them", async () => {
    const store = memoryStore();
    const closed: string[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const tasks = new Map<string, TodoistTaskView>([
      ["6hJCfm66Hh5Q4wqv", { id: "6hJCfm66Hh5Q4wqv", content: "Complete me from component A", isCompleted: false, url: null, due: null }],
    ]);
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { title: "Test", taskIds: ["6hJCfm66Hh5Q4wqv"] } },
      { store, publish: () => {}, dataDir, todoist: fakeTodoist(tasks, closed), token: () => "ombui_test" },
    );
    expect(shown.ok).toBe(true);
    expect(closed).toEqual([]);
    if (!shown.ok) throw new Error(shown.error);
    const args: JsonObject = shown.value.arguments;
    expect(args.tasks).toEqual([
      { id: "6hJCfm66Hh5Q4wqv", content: "Complete me from component A", isCompleted: false, url: null, due: null, unavailable: false },
    ]);
  });

  it("reports a total Todoist load failure as an error component", async () => {
    const store = memoryStore();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const todoist: TodoistClient = {
      async getTask(taskId) {
        return { ok: false, error: `could not load ${taskId}` };
      },
      async closeTask() {
        return { ok: false, error: "not available" };
      },
    };
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: ["6hJCfm66Hh5Q4wqv"] } },
      { store, publish: () => {}, dataDir, todoist, token: () => "ombui_test" },
    );
    expect(shown).toMatchObject({ ok: true, value: { status: "error", result: "could not load 6hJCfm66Hh5Q4wqv" } });
  });

  it("refuses inexact or duplicate Todoist ids before loading tasks", async () => {
    const store = memoryStore();
    const closed: string[] = [];
    const loaded: string[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const todoist: TodoistClient = {
      async getTask(taskId) {
        loaded.push(taskId);
        return { ok: false, error: "unexpected load" };
      },
      async closeTask(taskId) {
        closed.push(taskId);
        return { ok: true, value: true };
      },
    };

    const padded = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: [" 6hJCfm66Hh5Q4wqv"] } },
      { store, publish: () => {}, dataDir, todoist, token: () => "ombui_test" },
    );
    expect(padded).toMatchObject({ ok: true, value: { status: "error" } });
    const duplicate = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: ["6hJCfm66Hh5Q4wqv", "6hJCfm66Hh5Q4wqv"] } },
      { store, publish: () => {}, dataDir, todoist, token: () => "ombui_test" },
    );
    expect(duplicate).toMatchObject({ ok: true, value: { status: "error" } });
    expect(loaded).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("completes only on an explicit click against an exact shown task id", async () => {
    const store = memoryStore();
    const closed: string[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "omb-ui-"));
    dirs.push(dataDir);
    const tasks = new Map<string, TodoistTaskView>([
      ["6hJCfm66Hh5Q4wqv", { id: "6hJCfm66Hh5Q4wqv", content: "A", isCompleted: false, url: null, due: null }],
      ["6hJCfmGxJHcvjQRM", { id: "6hJCfmGxJHcvjQRM", content: "B", isCompleted: false, url: null, due: null }],
    ]);
    const ctx = { store, publish: () => {}, dataDir, todoist: fakeTodoist(tasks, closed), token: () => "ombui_test" };
    const shown = await showComponent(
      { threadId: "t1", name: "show_todoist_tasks", arguments: { taskIds: ["6hJCfm66Hh5Q4wqv", "6hJCfmGxJHcvjQRM"] } },
      ctx,
    );
    expect(shown.ok).toBe(true);
    if (!shown.ok) return;
    const badId = await completeTodoistTask(
      { threadId: "t1", callId: shown.value.callId, taskId: "nope", actionToken: "ombui_test" },
      ctx,
    );
    expect(badId.ok).toBe(false);
    const padded = await completeTodoistTask(
      { threadId: "t1", callId: shown.value.callId, taskId: "6hJCfm66Hh5Q4wqv ", actionToken: "ombui_test" },
      ctx,
    );
    expect(padded.ok).toBe(false);
    const badToken = await completeTodoistTask(
      { threadId: "t1", callId: shown.value.callId, taskId: "6hJCfm66Hh5Q4wqv", actionToken: "wrong" },
      ctx,
    );
    expect(badToken.ok).toBe(false);
    expect(closed).toEqual([]);
    const ok = await completeTodoistTask(
      { threadId: "t1", callId: shown.value.callId, taskId: "6hJCfm66Hh5Q4wqv", actionToken: "ombui_test" },
      ctx,
    );
    expect(ok).toEqual({ ok: true, value: { taskId: "6hJCfm66Hh5Q4wqv" } });
    expect(closed).toEqual(["6hJCfm66Hh5Q4wqv"]);
    const trail = readUiActions(dataDir);
    expect(trail.some((row) => row.kind === "complete-accepted" && row.taskId === "6hJCfm66Hh5Q4wqv")).toBe(true);
    expect(trail.some((row) => row.kind === "complete-rejected")).toBe(true);
  });
});
