import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { newEventId, newId, type Json, type JsonObject, type RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import type { ComponentCall, Result, TodoistTaskView } from "./contract.ts";
import { asJsonObject, isJsonObject } from "./contract.ts";
import { appendUiAction } from "./evidence.ts";
import { GALLERY_BY_NAME } from "./gallery.ts";
import { loadTodoistTasks, type TodoistClient } from "./todoist.ts";
import { validateArgs } from "./validate.ts";

export type ShowStore = {
  appendMessage: (threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }) => Message;
  messagesFor: (threadId: string) => Message[];
  patchMessage: (threadId: string, messageId: string, patch: Partial<Message>) => Message | null;
};

export type ShowInput = {
  threadId: string;
  name: string;
  arguments: Json;
  provider?: string;
  turnId?: string;
  from?: Message["from"];
};

export type CompleteInput = {
  threadId: string;
  callId: string;
  taskId: string;
  actionToken: string;
};

export type ShowContext = {
  store: ShowStore;
  publish: (event: RuntimeEvent) => void;
  dataDir: string;
  todoist: TodoistClient;
  now?: () => string;
  token?: () => string;
};

const TODOIST_NAME = "show_todoist_tasks";
const STRING = z.string();
const TASK_IDS = z.array(z.string());

function stringValue(value: Json | undefined, fallback: string): string {
  const parsed = STRING.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function newActionToken(): string {
  return `ombui_${randomBytes(18).toString("hex")}`;
}

function actionTokenMatches(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function showComponent(input: ShowInput, ctx: ShowContext): Promise<Result<ComponentCall, string>> {
  const spec = GALLERY_BY_NAME.get(input.name);
  if (!spec) return { ok: false, error: `Unknown component: ${input.name}` };

  const checked = validateArgs(spec.parameters, input.arguments);
  if (!checked.ok) return checked;

  let storedArgs = checked.value;
  let result = spec.confirmation;
  let status: ComponentCall["status"] = "shown";

  if (spec.name === TODOIST_NAME) {
    const resolved = await resolveTodoistArgs(checked.value, ctx.todoist);
    storedArgs = resolved.arguments;
    if (resolved.errors.length && !resolved.tasks.some((task) => task.unavailable !== true)) {
      status = "error";
      result = resolved.errors.join(" ");
    }
  }

  const call: ComponentCall = {
    callId: newId(),
    name: spec.name,
    arguments: storedArgs,
    result,
    status,
    actionToken: (ctx.token ?? newActionToken)(),
  };

  ctx.store.appendMessage(input.threadId, {
    role: "bot",
    kind: "component",
    component: call,
    from: input.from,
  });
  const saved = call;

  const at = (ctx.now ?? (() => new Date().toISOString()))();
  ctx.publish({
    eventId: newEventId(),
    provider: input.provider ?? "ui",
    threadId: input.threadId,
    createdAt: at,
    turnId: input.turnId,
    type: "component.shown",
    name: saved.name,
    arguments: saved.arguments,
    result: saved.result,
    status: saved.status,
    callId: saved.callId,
  });
  appendUiAction(ctx.dataDir, {
    at,
    kind: "shown",
    threadId: input.threadId,
    callId: saved.callId,
    name: saved.name,
    ok: saved.status === "shown",
    detail: saved.result,
  });
  return { ok: true, value: saved };
}

function exactTodoistTaskIds(value: Json | undefined): Result<string[], string> {
  const parsed = TASK_IDS.safeParse(value);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, error: "At least one exact Todoist task id is required." };
  const seen = new Set<string>();
  for (const taskId of parsed.data) {
    if (!taskId || taskId.trim() !== taskId) {
      return { ok: false, error: "Todoist task ids must be non-empty strings with no surrounding whitespace." };
    }
    if (seen.has(taskId)) return { ok: false, error: `Todoist task id ${taskId} was provided more than once.` };
    seen.add(taskId);
  }
  return { ok: true, value: parsed.data };
}

async function resolveTodoistArgs(
  args: JsonObject,
  client: TodoistClient,
): Promise<{ arguments: JsonObject; tasks: TodoistTaskView[]; errors: string[] }> {
  const exactIds = exactTodoistTaskIds(args.taskIds);
  if (!exactIds.ok) {
    return {
      arguments: asJsonObject({ title: stringValue(args.title, "Todoist tasks"), tasks: [] }),
      tasks: [],
      errors: [exactIds.error],
    };
  }
  const { tasks, errors } = await loadTodoistTasks(exactIds.value, client);
  const title = stringValue(args.title, "Todoist tasks");
  return {
    arguments: asJsonObject({
      title,
      tasks: tasks.map((task) => ({
        id: task.id,
        content: task.content,
        isCompleted: task.isCompleted,
        url: task.url,
        due: task.due,
        unavailable: task.unavailable === true,
      })),
    }),
    tasks,
    errors,
  };
}

export function findComponentCall(store: ShowStore, threadId: string, callId: string): { message: Message; call: ComponentCall } | null {
  const message = store.messagesFor(threadId).find((row) => row.kind === "component" && row.component?.callId === callId);
  if (!message?.component) return null;
  return { message, call: message.component };
}

export function listedTaskIds(args: JsonObject): string[] {
  const tasks = args.tasks;
  if (!Array.isArray(tasks)) return [];
  const ids: string[] = [];
  for (const task of tasks) {
    if (!isJsonObject(task)) continue;
    const id = STRING.safeParse(task.id);
    if (id.success) ids.push(id.data);
  }
  return ids;
}

function listedTask(args: JsonObject, taskId: string): JsonObject | null {
  const tasks = args.tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (isJsonObject(task) && task.id === taskId) return task;
  }
  return null;
}

export async function completeTodoistTask(input: CompleteInput, ctx: ShowContext): Promise<Result<{ taskId: string }, string>> {
  const at = (ctx.now ?? (() => new Date().toISOString()))();
  const reject = (detail: string): Result<{ taskId: string }, string> => {
    appendUiAction(ctx.dataDir, {
      at,
      kind: "complete-rejected",
      threadId: input.threadId,
      callId: input.callId,
      name: TODOIST_NAME,
      taskId: input.taskId,
      ok: false,
      detail,
    });
    return { ok: false, error: detail };
  };

  const taskId = input.taskId.trim();
  if (!taskId) return reject("A task id is required.");
  if (taskId !== input.taskId) return reject("Task id must match exactly, with no extra space.");

  const found = findComponentCall(ctx.store, input.threadId, input.callId);
  if (!found) return reject("That component call is not in this thread.");
  if (found.call.name !== TODOIST_NAME) return reject("That component cannot complete a Todoist task.");
  if (!actionTokenMatches(found.call.actionToken, input.actionToken)) {
    return reject("This completion request was not authenticated.");
  }

  const task = listedTask(found.call.arguments, taskId);
  if (!task) return reject("That task is not one of the tasks shown on this component.");
  if (task.unavailable === true) return reject("That task was unavailable when this component was shown.");
  if (task.isCompleted === true) return reject("That task is already completed in this component.");

  const closed = await ctx.todoist.closeTask(taskId);
  if (!closed.ok) return reject(closed.error);

  const nextArgs = markTaskCompleted(found.call.arguments, taskId);
  ctx.store.patchMessage(input.threadId, found.message.id, {
    component: { ...found.call, arguments: nextArgs },
  });
  appendUiAction(ctx.dataDir, {
    at,
    kind: "complete-accepted",
    threadId: input.threadId,
    callId: input.callId,
    name: TODOIST_NAME,
    taskId,
    ok: true,
    detail: "completed by explicit click",
  });
  return { ok: true, value: { taskId } };
}

function markTaskCompleted(args: JsonObject, taskId: string): JsonObject {
  const tasks = args.tasks;
  if (!Array.isArray(tasks)) return args;
  return asJsonObject({
    ...args,
    tasks: tasks.map((task) => {
      if (!isJsonObject(task) || task.id !== taskId) return task;
      return { ...task, isCompleted: true, unavailable: false };
    }),
  });
}
