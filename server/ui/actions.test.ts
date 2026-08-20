import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR, ensureDirs } from "../config.ts";
import { closeMessageDb } from "../message-db.ts";
import type { Message } from "../store.ts";
import {
  actionEventsForThread,
  claimActionExecution,
  closeActionDb,
  writeSupplementLedger,
} from "./action-db.ts";
import {
  beginTodoistAction,
  completeTodoistAction,
  failTodoistAction,
  recoverStartedSupplementActions,
  recoverStartedTodoistActions,
  toggleSupplementItem,
  type ComponentActionContext,
} from "./actions.ts";
import type { TodoistTaskView } from "./contract.ts";
import type { TodoistClient } from "./todoist.ts";

function memoryStore(initial: Message[]) {
  const messages = [...initial];
  let nextId = 100;
  return {
    messages,
    appendMessage(_threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
      const full: Message = { id: `m-${nextId += 1}`, at: Date.now(), parentId: messages.at(-1)?.id ?? null, ...message };
      messages.push(full);
      return full;
    },
    messagesFor(): Message[] {
      return messages;
    },
    patchMessage(_threadId: string, messageId: string, patch: Partial<Message>): Message | null {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) return null;
      messages[index] = { ...messages[index], ...patch };
      return messages[index];
    },
  };
}

function todoistTask(overrides: Partial<TodoistTaskView> = {}): TodoistTaskView {
  return {
    id: "task-1",
    content: "Confirm the guest list",
    isCompleted: false,
    url: null,
    due: "2026-08-21",
    recurring: false,
    ...overrides,
  };
}

function todoistClient(task: TodoistTaskView, completed = false): TodoistClient & { getTask: ReturnType<typeof vi.fn> } {
  return {
    getTask: vi.fn(async () => ({ ok: true as const, value: task })),
    closeTask: async () => {
      throw new Error("the server must never execute the external close");
    },
    wasCompleted: async () => ({ ok: true, value: completed }),
  };
}

function todoistComponent(): Message {
  return {
    id: "component-1",
    at: Date.now(),
    parentId: null,
    role: "bot",
    kind: "component",
    component: {
      callId: "call-1",
      name: "show_todoist_tasks",
      arguments: {
        title: "Tasks",
        tasks: [{
          id: "task-1",
          content: "Confirm the guest list",
          isCompleted: false,
          url: null,
          due: "2026-08-21",
          recurring: false,
          unavailable: false,
        }],
      },
      result: "shown",
      status: "shown",
      origin: { provider: "test" },
    },
  };
}

function supplementComponent(): Message {
  return {
    id: "supplement-1",
    at: Date.now(),
    parentId: null,
    role: "bot",
    kind: "component",
    component: {
      callId: "supplement-call",
      name: "show_supplement_stack",
      arguments: {
        title: "Stack",
        date: "2026-08-20",
        timeZone: "America/Los_Angeles",
        regimen: { version: "v1", snapshotAt: "2026-08-20T12:00:00Z", source: "Protocol" },
        groups: [{ period: "pm", items: [{ id: "magnesium", label: "Magnesium", checked: false }] }],
      },
      result: "shown",
      status: "shown",
      origin: { provider: "test" },
    },
  };
}

function context(
  store: ReturnType<typeof memoryStore>,
  todoist: TodoistClient,
  now = "2026-08-20T12:00:00.000Z",
): ComponentActionContext {
  return {
    store,
    publish: () => {},
    dataDir: DATA_DIR,
    todoist,
    now: () => now,
    onTerminal: vi.fn(),
  };
}

beforeEach(() => {
  closeActionDb();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  ensureDirs();
});

describe("trusted component actions", () => {
  it("durably claims Todoist once and never executes the external close server-side", async () => {
    const store = memoryStore([todoistComponent()]);
    const client = todoistClient(todoistTask());
    const ctx = context(store, client);
    const input = { threadId: "thread-1", callId: "call-1", taskId: "task-1", botId: "bot-1" };

    const first = await beginTodoistAction(input, ctx);
    const duplicate = await beginTodoistAction(input, ctx);
    expect(first).toMatchObject({ ok: true, value: { taskId: "task-1" } });
    expect(duplicate).toMatchObject({ ok: false, error: expect.stringContaining("already in progress") });
    expect(client.getTask).toHaveBeenCalledTimes(1);
    expect(actionEventsForThread("thread-1")).toHaveLength(1);
  });

  it("persists the room member owner from the component message for follow-up routing", async () => {
    const component = todoistComponent();
    component.from = { botId: "room-member", name: "Planner", color: "blue" };
    const store = memoryStore([component]);
    const claim = await beginTodoistAction(
      { threadId: "room-thread", callId: "call-1", taskId: "task-1" },
      context(store, todoistClient(todoistTask())),
    );
    expect(claim.ok).toBe(true);
    expect(actionEventsForThread("room-thread")[0]?.botId).toBe("room-member");
  });

  it("reclaims an expired or proven-failed Todoist attempt only after read-only remote verification", async () => {
    const store = memoryStore([todoistComponent()]);
    const client = todoistClient(todoistTask());
    const firstContext = context(store, client);
    const input = { threadId: "thread-1", callId: "call-1", taskId: "task-1" };
    const first = await beginTodoistAction(input, firstContext);
    if (!first.ok) throw new Error(first.error);

    const expiredContext = context(store, client, "2026-08-20T12:01:00.000Z");
    const reclaimed = await beginTodoistAction(input, expiredContext);
    expect(reclaimed).toMatchObject({ ok: true, value: { actionId: first.value.actionId } });
    expect(actionEventsForThread("thread-1")[0]?.execution.attempt).toBe(2);

    const failed = await failTodoistAction({
      ...input,
      actionId: first.value.actionId,
      error: "Todoist returned 503 before writing.",
    }, expiredContext);
    expect(failed).toMatchObject({ ok: true, value: { status: "failed" } });
    const retried = await beginTodoistAction(input, context(store, client, "2026-08-20T12:02:00.000Z"));
    expect(retried).toMatchObject({ ok: true, value: { actionId: first.value.actionId } });
    expect(actionEventsForThread("thread-1")[0]?.execution.attempt).toBe(3);
  });

  it("settles a trusted Electron success once, patches the component, and appends one activity", async () => {
    const store = memoryStore([todoistComponent()]);
    const ctx = context(store, todoistClient(todoistTask()));
    const claim = await beginTodoistAction({ threadId: "thread-1", callId: "call-1", taskId: "task-1" }, ctx);
    if (!claim.ok) throw new Error(claim.error);
    const input = { actionId: claim.value.actionId, threadId: "thread-1", callId: "call-1", taskId: "task-1" };

    expect((await completeTodoistAction(input, ctx)).ok).toBe(true);
    expect((await completeTodoistAction(input, ctx)).ok).toBe(true);
    expect(store.messages.filter((message) => message.kind === "activity")).toHaveLength(1);
    expect(store.messages[0]?.component?.arguments).toMatchObject({ tasks: [{ isCompleted: true }] });
    expect(actionEventsForThread("thread-1")[0]).toMatchObject({ status: "succeeded", followUp: { status: "pending" } });
  });

  it("reconciles a timeout as success when completed-task history proves the close landed", async () => {
    const store = memoryStore([todoistComponent()]);
    const client = todoistClient(todoistTask(), true);
    const ctx = context(store, client);
    const input = { threadId: "thread-1", callId: "call-1", taskId: "task-1" };
    const claim = await beginTodoistAction(input, ctx);
    if (!claim.ok) throw new Error(claim.error);
    const result = await failTodoistAction({
      ...input,
      actionId: claim.value.actionId,
      error: "The close request timed out.",
    }, ctx);
    expect(result).toMatchObject({ ok: true, value: { status: "succeeded", trustedOrigin: "recovery" } });
    expect(store.messages[0]?.component?.arguments).toMatchObject({ tasks: [{ isCompleted: true }] });
  });

  it("makes a local supplement action idempotent and never ticks situational items", () => {
    const store = memoryStore([supplementComponent()]);
    const ctx = context(store, todoistClient(todoistTask()));
    const input = {
      actionId: "3a58a7e8-3ce0-4cb8-b172-f6ce0948e6ce",
      threadId: "thread-1",
      callId: "supplement-call",
      itemId: "magnesium",
      date: "2026-08-20",
      checked: true,
    };
    expect(toggleSupplementItem(input, ctx)).toMatchObject({ ok: true, value: { checked: true, changed: true } });
    expect(toggleSupplementItem(input, ctx)).toMatchObject({ ok: true, value: { checked: true, changed: false } });
    expect(store.messages.filter((message) => message.kind === "activity")).toHaveLength(1);
    expect(actionEventsForThread("thread-1")).toHaveLength(1);
  });

  it("recovers a committed local ledger write after restart without applying it twice", () => {
    const store = memoryStore([supplementComponent()]);
    const ctx = context(store, todoistClient(todoistTask()));
    const now = new Date("2026-08-20T12:00:00.000Z");
    const claimed = claimActionExecution({
      actionId: "6e916e11-a0f0-4cb5-b050-3a24e66522e7",
      idempotencyKey: "supplement:6e916e11-a0f0-4cb5-b050-3a24e66522e7",
      threadId: "thread-1",
      callId: "supplement-call",
      componentName: "show_supplement_stack",
      actionName: "tick_item",
      entity: {
        id: "magnesium",
        label: "Magnesium",
        localDate: "2026-08-20",
        regimenVersion: "v1",
        targetChecked: true,
      },
      result: { summary: "Checking Magnesium." },
      status: "started",
      trustedOrigin: "same_origin_browser",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }, now);
    expect(claimed.ok).toBe(true);
    writeSupplementLedger({
      localDate: "2026-08-20",
      regimenVersion: "v1",
      itemId: "magnesium",
      checked: true,
      updatedAt: now.toISOString(),
    });

    recoverStartedSupplementActions(ctx);
    recoverStartedSupplementActions(ctx);
    expect(actionEventsForThread("thread-1")[0]?.status).toBe("succeeded");
    expect(store.messages.filter((message) => message.kind === "activity")).toHaveLength(1);
    expect(store.messages[0]?.component?.arguments).toMatchObject({ groups: [{ items: [{ checked: true }] }] });
  });

  it("recovers a close from completed-task history without re-executing it", async () => {
    const store = memoryStore([todoistComponent()]);
    const client = todoistClient(todoistTask(), true);
    const ctx = context(store, client);
    const claim = await beginTodoistAction({ threadId: "thread-1", callId: "call-1", taskId: "task-1" }, ctx);
    if (!claim.ok) throw new Error(claim.error);

    await recoverStartedTodoistActions(ctx);
    expect(actionEventsForThread("thread-1")[0]?.status).toBe("succeeded");
    expect(store.messages[0]?.component?.arguments).toMatchObject({ tasks: [{ isCompleted: true }] });
  });
});
