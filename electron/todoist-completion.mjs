import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const TODOIST_API = "https://api.todoist.com/api/v1";
const ACTION_ID = z.string().min(1).max(200);
const CompletionPayload = z.object({
  threadId: z.string().min(1).max(200).refine((value) => value.trim() === value),
  callId: z.string().min(1).max(200).refine((value) => value.trim() === value),
  taskId: z.string().min(1).max(200).refine((value) => value.trim() === value),
}).strict();

export function parseTodoistCompletionPayload(value) {
  const parsed = CompletionPayload.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function resolveServerPort(value, fallback = 8799) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

export class TodoistCompletionGate {
  #consumed = new Set();

  async run(key, action) {
    if (this.#consumed.has(key)) throw new Error("This Todoist completion was already requested.");
    // Consume before awaiting the remote write. Parallel callers observe the
    // consumed state immediately and cannot issue a second close request.
    this.#consumed.add(key);
    try {
      return await action();
    } catch (error) {
      // Only a failed remote write re-arms this exact call/task pair.
      this.#consumed.delete(key);
      throw error;
    }
  }
}

export function completionKey({ threadId, callId, taskId }) {
  return JSON.stringify([threadId, callId, taskId]);
}

export function appendTodoistCompletionReceipt(dataDir, payload, at = new Date().toISOString()) {
  const actionId = ACTION_ID.safeParse(payload.actionId);
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(
    join(dataDir, "ui-actions.ndjson"),
    JSON.stringify({
      at,
      kind: "complete-accepted",
      threadId: payload.threadId,
      callId: payload.callId,
      actionId: actionId.success ? actionId.data : undefined,
      name: "show_todoist_tasks",
      taskId: payload.taskId,
      ok: true,
      detail: "Todoist close returned success through Electron IPC",
    }) + "\n",
    { mode: 0o600 },
  );
}

export async function closeTodoistTask(token, taskId, fetchImpl = fetch) {
  if (!token) throw new Error("Todoist is not configured on this machine.");
  const response = await fetchImpl(`${TODOIST_API}/tasks/${encodeURIComponent(taskId)}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204 || response.ok) return;
  if (response.status === 404) throw new Error(`Todoist has no task ${taskId}.`);
  throw new Error(`Todoist could not complete that task (${response.status}).`);
}
