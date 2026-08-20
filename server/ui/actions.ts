import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { JsonObject } from "../contracts.ts";
import type { Message } from "../store.ts";
import {
  actionEventById,
  actionEventByIdempotencyKey,
  allActionEvents,
  boundedActionResult,
  claimActionExecution,
  readSupplementLedger,
  updateActionEvent,
  writeSupplementLedger,
} from "./action-db.ts";
import type { ComponentActionEvent, Result, TodoistTaskView } from "./contract.ts";
import { isJsonObject } from "./contract.ts";
import { SupplementStackSchema } from "./schemas.ts";
import {
  applyTrustedTodoistCompletion,
  findComponentCall,
  reconcileTodoistCompletion,
  todoistCompletionCandidate,
  type CompletionInput,
  type ShowContext,
} from "./show.ts";
import type { TodoistClient } from "./todoist.ts";

export type ComponentActionContext = ShowContext & {
  onTerminal: (event: ComponentActionEvent) => void;
};

export type TodoistActionClaim = CompletionInput & { botId?: string };
export type TodoistActionCompletion = CompletionInput & { actionId: string; botId?: string };
export type SupplementToggleInput = {
  actionId: string;
  threadId: string;
  callId: string;
  itemId: string;
  date: string;
  checked: boolean;
  botId?: string;
};

const STRING = z.string();
const BOOLEAN = z.boolean();

function entityLabel(value: JsonObject, fallback: string): string {
  const label = STRING.safeParse(value.content ?? value.label);
  return label.success ? label.data : fallback;
}

function appendActivity(
  ctx: ComponentActionContext,
  event: ComponentActionEvent,
  message: string,
  ok: boolean,
  from?: Message["from"],
): void {
  ctx.store.appendMessage(event.threadId, {
    role: "bot",
    kind: "activity",
    from,
    tool: {
      name: message.slice(0, 400),
      ok,
      status: ok ? "complete" : "error",
      result: STRING.safeParse(event.result.summary).success ? String(event.result.summary) : undefined,
    },
  });
}

function terminalEvent(
  ctx: ComponentActionContext,
  event: ComponentActionEvent,
  status: "succeeded" | "failed",
  result: JsonObject,
  trustedOrigin: ComponentActionEvent["trustedOrigin"],
): Result<ComponentActionEvent, string> {
  const updatedAt = (ctx.now ?? (() => new Date().toISOString()))();
  const execution: ComponentActionEvent["execution"] = { attempt: event.execution.attempt };
  if (status === "failed") {
    execution.leaseUntil = new Date(Date.parse(updatedAt) + 30_000).toISOString();
  }
  const updated = updateActionEvent(event.actionId, {
    status,
    result,
    trustedOrigin,
    updatedAt,
    execution,
    followUp: { status: "pending", attempt: 0 },
  });
  if (updated.ok) ctx.onTerminal(updated.value);
  return updated;
}

type TodoistReconciliation =
  | { kind: "completed" }
  | { kind: "active"; task: TodoistTaskView }
  | { kind: "ambiguous"; error: string };

async function reconcileTodoistOutcome(
  event: ComponentActionEvent,
  client: TodoistClient,
): Promise<TodoistReconciliation> {
  if (client.wasCompleted) {
    const history = await client.wasCompleted(String(event.entity.id ?? ""), event.createdAt);
    if (!history.ok) return { kind: "ambiguous", error: history.error };
    if (history.value) return { kind: "completed" };
  }
  const active = await client.getTask(String(event.entity.id ?? ""));
  if (!active.ok) return { kind: "ambiguous", error: active.error };
  if (active.value.isCompleted) return { kind: "completed" };
  const shownDue = STRING.safeParse(event.entity.shownDue);
  if (event.entity.recurring === true && (!shownDue.success || active.value.due !== shownDue.data)) {
    return { kind: "ambiguous", error: "The recurring task changed after the action attempt." };
  }
  return { kind: "active", task: active.value };
}

export async function beginTodoistAction(
  input: TodoistActionClaim,
  ctx: ComponentActionContext,
): Promise<Result<{ actionId: string; taskId: string }, string>> {
  const candidate = todoistCompletionCandidate(input, ctx);
  if (!candidate.ok) return candidate;
  const now = new Date((ctx.now ?? (() => new Date().toISOString()))());
  const taskLabel = entityLabel(candidate.value.task, candidate.value.taskId);
  const idempotencyKey = `todoist:${input.threadId}:${input.callId}:complete:${candidate.value.taskId}`;
  const existing = actionEventByIdempotencyKey(idempotencyKey);
  let allowVerifiedRetry = false;
  let verifiedRemote: Awaited<ReturnType<TodoistClient["getTask"]>> | null = null;
  const leaseExpired = (existing?.status === "started" || existing?.status === "failed") && (
    !existing.execution.leaseUntil || Date.parse(existing.execution.leaseUntil) <= now.getTime()
  );
  if (existing && leaseExpired) {
    const outcome = await reconcileTodoistOutcome(existing, ctx.todoist);
    if (outcome.kind === "completed") {
      await completeTodoistAction({ ...input, actionId: existing.actionId }, ctx, "recovery");
      return { ok: false, error: "That task was already completed in Todoist." };
    }
    if (outcome.kind === "ambiguous") {
      return { ok: false, error: "The previous Todoist attempt remains ambiguous and cannot be repeated safely." };
    }
    verifiedRemote = { ok: true, value: outcome.task };
    allowVerifiedRetry = true;
  }
  const claimed = claimActionExecution({
    actionId: randomUUID(),
    idempotencyKey,
    threadId: input.threadId,
    callId: input.callId,
    botId: input.botId ?? candidate.value.found.message.from?.botId,
    componentName: "show_todoist_tasks",
    actionName: "complete_task",
    entity: {
      id: candidate.value.taskId,
      label: taskLabel,
      service: "Todoist",
      recurring: candidate.value.task.recurring === true,
      shownDue: candidate.value.task.due ?? null,
    },
    result: boundedActionResult(`Completing “${taskLabel}” in Todoist.`),
    status: "started",
    trustedOrigin: "electron_main",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }, now, 30_000, { allowVerifiedRetry });
  if (!claimed.ok) return claimed;
  if (!claimed.value.claimed) return { ok: false, error: claimed.value.reason ?? "This action cannot run again." };

  const remote = verifiedRemote ?? await ctx.todoist.getTask(candidate.value.taskId);
  if (!remote.ok) {
    const failed = terminalEvent(
      ctx,
      claimed.value.event,
      "failed",
      boundedActionResult(`Todoist could not authorize “${taskLabel}”.`, remote.error),
      "electron_main",
    );
    if (failed.ok) appendActivity(ctx, failed.value, `Could not complete “${taskLabel}” in Todoist`, false, candidate.value.found.message.from);
    return { ok: false, error: remote.error };
  }
  if (remote.value.isCompleted) {
    await reconcileTodoistCompletion(input, ctx);
    const recovered = terminalEvent(
      ctx,
      claimed.value.event,
      "succeeded",
      boundedActionResult(`“${taskLabel}” was already completed in Todoist.`),
      "recovery",
    );
    if (recovered.ok) appendActivity(ctx, recovered.value, `Already completed “${taskLabel}” in Todoist`, true, candidate.value.found.message.from);
    return { ok: false, error: "That task is already completed in Todoist." };
  }
  return { ok: true, value: { actionId: claimed.value.event.actionId, taskId: candidate.value.taskId } };
}

function matchingTodoistEvent(input: TodoistActionCompletion): Result<ComponentActionEvent, string> {
  const event = actionEventById(input.actionId);
  if (!event) return { ok: false, error: "No trusted Todoist action has that action id." };
  if (
    event.threadId !== input.threadId ||
    event.callId !== input.callId ||
    event.componentName !== "show_todoist_tasks" ||
    event.actionName !== "complete_task" ||
    event.entity.id !== input.taskId
  ) return { ok: false, error: "The Todoist action does not match this component row." };
  return { ok: true, value: event };
}

export async function completeTodoistAction(
  input: TodoistActionCompletion,
  ctx: ComponentActionContext,
  trustedOrigin: ComponentActionEvent["trustedOrigin"] = "electron_main",
): Promise<Result<{ event: ComponentActionEvent; taskId: string }, string>> {
  const matched = matchingTodoistEvent(input);
  if (!matched.ok) return matched;
  if (matched.value.status === "succeeded") {
    return { ok: true, value: { event: matched.value, taskId: input.taskId } };
  }
  const applied = applyTrustedTodoistCompletion(input, ctx);
  if (!applied.ok) return applied;
  const label = entityLabel(applied.value.task, input.taskId);
  const completed = terminalEvent(
    ctx,
    matched.value,
    "succeeded",
    boundedActionResult(`Completed “${label}” in Todoist.`),
    trustedOrigin,
  );
  if (!completed.ok) return completed;
  appendActivity(ctx, completed.value, `Completed “${label}” in Todoist`, true, applied.value.message.from);
  return { ok: true, value: { event: completed.value, taskId: input.taskId } };
}

export async function failTodoistAction(
  input: TodoistActionCompletion & { error: string },
  ctx: ComponentActionContext,
): Promise<Result<ComponentActionEvent, string>> {
  const matched = matchingTodoistEvent(input);
  if (!matched.ok) return matched;
  if (matched.value.status === "succeeded") return matched;
  const outcome = await reconcileTodoistOutcome(matched.value, ctx.todoist);
  if (outcome.kind === "completed") {
    const recovered = await completeTodoistAction(input, ctx, "recovery");
    return recovered.ok ? { ok: true, value: recovered.value.event } : recovered;
  }
  if (outcome.kind === "ambiguous") {
    return { ok: false, error: "Todoist may have completed the task; OpenMaus left the action pending for safe recovery." };
  }
  if (matched.value.status === "failed") return matched;
  const found = findComponentCall(ctx.store, input.threadId, input.callId);
  const label = String(matched.value.entity.label ?? input.taskId);
  const failed = terminalEvent(
    ctx,
    matched.value,
    "failed",
    boundedActionResult(`Could not complete “${label}” in Todoist.`, input.error),
    "electron_main",
  );
  if (failed.ok) appendActivity(ctx, failed.value, `Could not complete “${label}” in Todoist`, false, found?.message.from);
  return failed;
}

function supplementCandidate(input: SupplementToggleInput, ctx: ComponentActionContext): Result<{
  found: NonNullable<ReturnType<typeof findComponentCall>>;
  stack: z.infer<typeof SupplementStackSchema>;
  label: string;
}, string> {
  const found = findComponentCall(ctx.store, input.threadId, input.callId);
  if (!found || found.call.name !== "show_supplement_stack") {
    return { ok: false, error: "That supplement stack is not in this thread." };
  }
  const parsed = SupplementStackSchema.safeParse(found.call.arguments);
  if (!parsed.success) return { ok: false, error: "That supplement stack could not be read safely." };
  if (parsed.data.date !== input.date) return { ok: false, error: "The ledger date does not match this stack." };
  for (const group of parsed.data.groups) {
    const item = group.items.find((candidate) => candidate.id === input.itemId);
    if (!item) continue;
    if (group.period === "situational" || item.situational === true) {
      return { ok: false, error: "Situational supplements do not use normal daily ticks." };
    }
    return { ok: true, value: { found, stack: parsed.data, label: item.label } };
  }
  return { ok: false, error: "That supplement is not in this stack." };
}

export function toggleSupplementItem(
  input: SupplementToggleInput,
  ctx: ComponentActionContext,
): Result<{ event: ComponentActionEvent; checked: boolean; changed: boolean }, string> {
  const idempotencyKey = `supplement:${input.actionId}`;
  const prior = actionEventByIdempotencyKey(idempotencyKey);
  if (prior) {
    const checked = prior.result.checked === true;
    return { ok: true, value: { event: prior, checked, changed: false } };
  }
  const candidate = supplementCandidate(input, ctx);
  if (!candidate.ok) return candidate;
  const now = new Date((ctx.now ?? (() => new Date().toISOString()))());
  const regimenVersion = candidate.value.stack.regimen.version;
  const claimed = claimActionExecution({
    actionId: input.actionId,
    idempotencyKey,
    threadId: input.threadId,
    callId: input.callId,
    botId: input.botId ?? candidate.value.found.message.from?.botId,
    componentName: "show_supplement_stack",
    actionName: input.checked ? "tick_item" : "untick_item",
    entity: {
      id: input.itemId,
      label: candidate.value.label,
      localDate: input.date,
      regimenVersion,
      targetChecked: input.checked,
    },
    result: boundedActionResult(`${input.checked ? "Checking" : "Unchecking"} “${candidate.value.label}”.`),
    status: "started",
    trustedOrigin: "same_origin_browser",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }, now, 10_000);
  if (!claimed.ok) return claimed;
  if (!claimed.value.claimed) {
    return { ok: true, value: { event: claimed.value.event, checked: input.checked, changed: false } };
  }

  const ledger = writeSupplementLedger({
    localDate: input.date,
    regimenVersion,
    itemId: input.itemId,
    checked: input.checked,
    updatedAt: now.toISOString(),
  });
  const nextStack = {
    ...candidate.value.stack,
    groups: candidate.value.stack.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => item.id === input.itemId ? { ...item, checked: input.checked } : item),
    })),
  };
  const safeStack = SupplementStackSchema.safeParse(nextStack);
  if (!safeStack.success) return { ok: false, error: "The local supplement ledger update was not safe to render." };
  const argumentsObject = isJsonObject(safeStack.data) ? safeStack.data : null;
  if (!argumentsObject) return { ok: false, error: "The local supplement ledger update was not a JSON object." };
  ctx.store.patchMessage(input.threadId, candidate.value.found.message.id, {
    component: { ...candidate.value.found.call, arguments: argumentsObject },
  });
  const result: JsonObject = {
    summary: `${input.checked ? "Checked" : "Unchecked"} “${candidate.value.label}” for ${input.date}.`,
    checked: input.checked,
    changed: ledger.changed,
    regimenVersion,
  };
  const completed = terminalEvent(ctx, claimed.value.event, "succeeded", result, "same_origin_browser");
  if (!completed.ok) return completed;
  if (ledger.changed) {
    appendActivity(
      ctx,
      completed.value,
      `${input.checked ? "Checked" : "Unchecked"} “${candidate.value.label}” for ${input.date}`,
      true,
      candidate.value.found.message.from,
    );
  }
  return { ok: true, value: { event: completed.value, checked: input.checked, changed: ledger.changed } };
}

export async function recoverStartedTodoistActions(ctx: ComponentActionContext): Promise<void> {
  for (const event of allActionEvents()) {
    if (
      (event.status !== "started" && event.status !== "failed") ||
      event.componentName !== "show_todoist_tasks" ||
      event.actionName !== "complete_task"
    ) continue;
    const taskId = STRING.safeParse(event.entity.id);
    if (!taskId.success) continue;
    const outcome = await reconcileTodoistOutcome(event, ctx.todoist);
    if (outcome.kind !== "completed") continue;
    await completeTodoistAction({
      actionId: event.actionId,
      threadId: event.threadId,
      callId: event.callId,
      taskId: taskId.data,
      botId: event.botId,
    }, ctx, "recovery");
  }
}

export function recoverStartedSupplementActions(ctx: ComponentActionContext): void {
  for (const event of allActionEvents()) {
    if (
      event.status !== "started" ||
      event.componentName !== "show_supplement_stack" ||
      (event.actionName !== "tick_item" && event.actionName !== "untick_item")
    ) continue;
    const itemId = STRING.safeParse(event.entity.id);
    const localDate = STRING.safeParse(event.entity.localDate);
    const regimenVersion = STRING.safeParse(event.entity.regimenVersion);
    const targetChecked = BOOLEAN.safeParse(event.entity.targetChecked);
    if (!itemId.success || !localDate.success || !regimenVersion.success || !targetChecked.success) continue;
    const ledger = readSupplementLedger(localDate.data, regimenVersion.data);
    if (ledger.get(itemId.data) !== targetChecked.data) continue;
    const found = findComponentCall(ctx.store, event.threadId, event.callId);
    if (!found || found.call.name !== "show_supplement_stack") continue;
    const stack = SupplementStackSchema.safeParse(found.call.arguments);
    if (!stack.success) continue;
    const next = SupplementStackSchema.safeParse({
      ...stack.data,
      groups: stack.data.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => item.id === itemId.data ? { ...item, checked: targetChecked.data } : item),
      })),
    });
    if (!next.success || !isJsonObject(next.data)) continue;
    ctx.store.patchMessage(event.threadId, found.message.id, {
      component: { ...found.call, arguments: next.data },
    });
    const summary = `${targetChecked.data ? "Checked" : "Unchecked"} “${String(event.entity.label ?? itemId.data)}” for ${localDate.data}.`;
    const recovered = terminalEvent(ctx, event, "succeeded", {
      summary,
      checked: targetChecked.data,
      changed: true,
      regimenVersion: regimenVersion.data,
    }, "recovery");
    if (recovered.ok) appendActivity(ctx, recovered.value, summary, true, found.message.from);
  }
}

export function supplementLedgerSnapshot(localDate: string, regimenVersion: string): ReadonlyMap<string, boolean> {
  return readSupplementLedger(localDate, regimenVersion);
}
