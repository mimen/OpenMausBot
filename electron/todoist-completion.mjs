import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TODOIST_API = "https://api.todoist.com/api/v1";
const COMPLETION_FIELDS = new Set(["threadId", "callId", "taskId"]);

function exactIdentifier(value) {
  if (value?.constructor !== String || Object(value) === value) return null;
  const text = String(value);
  return text.length >= 1 && text.length <= 200 && text.trim() === text ? text : null;
}

export function parseTodoistCompletionPayload(value) {
  if (value === null || Object(value) !== value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== COMPLETION_FIELDS.size || keys.some((key) => !COMPLETION_FIELDS.has(key))) return null;
  const threadId = exactIdentifier(value.threadId);
  const callId = exactIdentifier(value.callId);
  const taskId = exactIdentifier(value.taskId);
  return threadId && callId && taskId ? { threadId, callId, taskId } : null;
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
  const actionId = exactIdentifier(payload.actionId);
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(
    join(dataDir, "ui-actions.ndjson"),
    JSON.stringify({
      at,
      kind: "complete-accepted",
      threadId: payload.threadId,
      callId: payload.callId,
      actionId: actionId ?? undefined,
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
