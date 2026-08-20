import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR, ensureDirs } from "../config.ts";
import { closeMessageDb } from "../message-db.ts";
import { Store } from "../store.ts";
import type { TodoistTaskView } from "./contract.ts";
import { completeTodoistTask, showComponent } from "./show.ts";
import type { TodoistClient } from "./todoist.ts";

const TASK_A = "6hJCfm66Hh5Q4wqv";
const TASK_B = "6hJCfmGxJHcvjQRM";

function fakeTodoist(tasks: ReadonlyMap<string, TodoistTaskView>): TodoistClient {
  return {
    async getTask(taskId) {
      const task = tasks.get(taskId);
      return task ? { ok: true, value: task } : { ok: false, error: `missing ${taskId}` };
    },
    async closeTask(taskId) {
      return tasks.has(taskId) ? { ok: true, value: true } : { ok: false, error: `missing ${taskId}` };
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

describe("component transcript replay", () => {
  it("restores the structured call and completed Todoist row from SQLite", async () => {
    const tasks = new Map<string, TodoistTaskView>([
      [TASK_A, { id: TASK_A, content: "Task A", isCompleted: false, url: null, due: null }],
      [TASK_B, { id: TASK_B, content: "Task B", isCompleted: false, url: null, due: null }],
    ]);
    const todoist = fakeTodoist(tasks);
    const store = new Store(() => ({ instanceId: "claude", model: "test" }));
    const bot = store.createBot({ name: "Replay" }, { seedMessages: false });
    const context = { store, publish: () => {}, dataDir: DATA_DIR, todoist, token: () => "ombui_replay" };

    const shown = await showComponent(
      { threadId: bot.threadId, name: "show_todoist_tasks", arguments: { title: "Replay tasks", taskIds: [TASK_A, TASK_B] } },
      context,
    );
    expect(shown.ok).toBe(true);
    if (!shown.ok) return;

    const completed = await completeTodoistTask(
      { threadId: bot.threadId, callId: shown.value.callId, taskId: TASK_A, actionToken: shown.value.actionToken },
      context,
    );
    expect(completed.ok).toBe(true);

    closeMessageDb();
    const restarted = new Store(() => ({ instanceId: "claude", model: "test" }));
    const replayed = restarted.messagesFor(bot.threadId).find((message) => message.kind === "component")?.component;

    expect(replayed).toMatchObject({
      callId: shown.value.callId,
      name: "show_todoist_tasks",
      result: shown.value.result,
      status: "shown",
      actionToken: "ombui_replay",
      arguments: {
        title: "Replay tasks",
        tasks: [
          { id: TASK_A, content: "Task A", isCompleted: true },
          { id: TASK_B, content: "Task B", isCompleted: false },
        ],
      },
    });
  });
});
