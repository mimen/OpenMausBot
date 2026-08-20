import { z } from "zod";

import { newEventId, newId, type Json, type JsonObject, type RuntimeEvent } from "../contracts.ts";
import type { Message } from "../store.ts";
import type { ComponentCall, ComponentOrigin, Result, TodoistTaskView } from "./contract.ts";
import { asJsonObject, ComponentCallSchema, isJsonObject, UI_LIMITS } from "./contract.ts";
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
  origin: ComponentOrigin;
  from?: Message["from"];
};

export type CompletionInput = {
  threadId: string;
  callId: string;
  taskId: string;
};

export type ShowContext = {
  store: ShowStore;
  publish: (event: RuntimeEvent) => void;
  dataDir: string;
  todoist: TodoistClient;
  now?: () => string;
};

const TODOIST_NAME = "show_todoist_tasks";
const STRING = z.string();
const TASK_IDS = z.array(z.string());

function stringValue(value: Json | undefined, fallback: string): string {
  const parsed = STRING.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function boundedResult(value: string): string {
  return value.slice(0, UI_LIMITS.result);
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
    result: boundedResult(result),
    status,
    origin: input.origin,
  };
  const safeCall = ComponentCallSchema.safeParse(call);
  if (!safeCall.success) {
    return { ok: false, error: "Component output exceeded the safe transcript limits." };
  }

  ctx.store.appendMessage(input.threadId, {
    role: "bot",
    kind: "component",
    component: call,
    from: input.from,
  });

  const at = (ctx.now ?? (() => new Date().toISOString()))();
  ctx.publish({
    eventId: newEventId(),
    provider: input.origin.provider,
    providerInstanceId: input.origin.providerInstanceId,
    threadId: input.threadId,
    createdAt: at,
    turnId: input.origin.turnId,
    itemId: input.origin.itemId,
    type: "component.shown",
    name: call.name,
    arguments: call.arguments,
    result: call.result,
    status: call.status,
    callId: call.callId,
  });
  appendUiAction(ctx.dataDir, {
    at,
    kind: "shown",
    threadId: input.threadId,
    callId: call.callId,
    name: call.name,
    ok: call.status === "shown",
    detail: call.result,
    origin: call.origin,
  });
  return { ok: true, value: call };
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
        description: task.description ?? null,
        isCompleted: task.isCompleted,
        url: task.url,
        due: task.due,
        projectId: task.projectId ?? null,
        projectName: task.projectName ?? null,
        labels: task.labels ?? [],
        commentCount: task.commentCount ?? 0,
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

function completionCandidate(
  input: CompletionInput,
  ctx: ShowContext,
  allowCompleted = false,
): Result<{ found: { message: Message; call: ComponentCall }; task: JsonObject; taskId: string }, string> {
  const taskId = input.taskId.trim();
  if (!taskId) return { ok: false, error: "A task id is required." };
  if (taskId !== input.taskId) return { ok: false, error: "Task id must match exactly, with no extra space." };
  const found = findComponentCall(ctx.store, input.threadId, input.callId);
  if (!found) return { ok: false, error: "That component call is not in this thread." };
  if (found.call.name !== TODOIST_NAME) return { ok: false, error: "That component cannot complete a Todoist task." };
  const task = listedTask(found.call.arguments, taskId);
  if (!task) return { ok: false, error: "That task is not one of the tasks shown on this component." };
  if (task.unavailable === true) return { ok: false, error: "That task was unavailable when this component was shown." };
  if (!allowCompleted && task.isCompleted === true) return { ok: false, error: "That task is already completed in this component." };
  return { ok: true, value: { found, task, taskId } };
}

/** Read-only authorization for the Electron main process. A curl can learn only
 * whether the transcript currently contains the row; it cannot close Todoist,
 * because the remote write exists solely behind Electron IPC. */
export async function authorizeTodoistCompletion(input: CompletionInput, ctx: ShowContext): Promise<Result<{ taskId: string }, string>> {
  const candidate = completionCandidate(input, ctx);
  if (!candidate.ok) return candidate;
  const remote = await ctx.todoist.getTask(candidate.value.taskId);
  if (!remote.ok) return remote;
  if (remote.value.isCompleted) {
    markCompleted(candidate.value.found, input, ctx);
    return { ok: false, error: "That task is already completed in Todoist." };
  }
  return { ok: true, value: { taskId: candidate.value.taskId } };
}

/** Reconcile a remote close into the transcript. This endpoint is read-only
 * against Todoist and never emits the trusted Electron action receipt. */
export async function reconcileTodoistCompletion(input: CompletionInput, ctx: ShowContext): Promise<Result<{ taskId: string }, string>> {
  const at = (ctx.now ?? (() => new Date().toISOString()))();
  const candidate = completionCandidate(input, ctx, true);
  if (!candidate.ok) {
    appendUiAction(ctx.dataDir, {
      at,
      kind: "complete-rejected",
      threadId: input.threadId,
      callId: input.callId,
      name: TODOIST_NAME,
      taskId: input.taskId,
      ok: false,
      detail: candidate.error,
    });
    return candidate;
  }
  if (candidate.value.task.isCompleted === true) {
    return { ok: true, value: { taskId: candidate.value.taskId } };
  }
  const remote = await ctx.todoist.getTask(candidate.value.taskId);
  const remoteError = !remote.ok
    ? remote.error
    : remote.value.isCompleted
      ? null
      : "Todoist has not confirmed this task as completed.";
  if (remoteError) {
    appendUiAction(ctx.dataDir, {
      at,
      kind: "complete-rejected",
      threadId: input.threadId,
      callId: input.callId,
      name: TODOIST_NAME,
      taskId: input.taskId,
      ok: false,
      detail: remoteError,
      origin: candidate.value.found.call.origin,
    });
    return { ok: false, error: remoteError };
  }
  markCompleted(candidate.value.found, input, ctx);
  return { ok: true, value: { taskId: candidate.value.taskId } };
}

function markCompleted(found: { message: Message; call: ComponentCall }, input: CompletionInput, ctx: ShowContext): void {
  const nextArgs = markTaskCompleted(found.call.arguments, input.taskId);
  ctx.store.patchMessage(input.threadId, found.message.id, {
    component: { ...found.call, arguments: nextArgs },
  });
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
