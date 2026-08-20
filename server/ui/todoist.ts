import { z } from "zod";

import type { Result, TodoistTaskView } from "./contract.ts";
import { UI_LIMITS } from "./contract.ts";

const TODOIST_API = "https://api.todoist.com/api/v1";
const TodoistTaskResponse = z.object({
  id: z.union([z.string(), z.number()]),
  content: z.string().max(UI_LIMITS.content),
  is_completed: z.boolean().optional(),
  checked: z.boolean().optional(),
  url: z.string().max(UI_LIMITS.value).nullable().optional(),
  due: z.object({ date: z.string().max(UI_LIMITS.label).nullable().optional() }).nullable().optional(),
});

export type TodoistClient = {
  getTask: (taskId: string) => Promise<Result<TodoistTaskView, string>>;
  closeTask: (taskId: string) => Promise<Result<true, string>>;
};

export type TodoistTokenSource = () => string | null;

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}>;

const TODOIST_RESPONSE_MAX_BYTES = 64 * 1024;

async function boundedResponseText(response: Awaited<ReturnType<FetchLike>>): Promise<Result<string, string>> {
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= TODOIST_RESPONSE_MAX_BYTES
      ? { ok: true, value: text }
      : { ok: false, error: "Todoist returned an oversized response." };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > TODOIST_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, error: "Todoist returned an oversized response." };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: text };
  } finally {
    reader.releaseLock();
  }
}

export function capturedTodoistToken(env: { [key: string]: string | undefined } = process.env): string | null {
  const token = env.TODOIST_API_TOKEN?.trim() || null;
  delete env.TODOIST_API_TOKEN;
  return token;
}

export function liveTodoistClient(tokenSource: TodoistTokenSource, fetchImpl: FetchLike = fetch): TodoistClient {
  return {
    async getTask(taskId) {
      const token = tokenSource();
      if (!token) return { ok: false, error: "Todoist is not configured on this machine." };
      try {
        const res = await fetchImpl(`${TODOIST_API}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 404) return { ok: false, error: `Todoist has no task ${taskId}.` };
        if (!res.ok) return { ok: false, error: `Todoist could not load that task (${res.status}).` };
        const body = await boundedResponseText(res);
        if (!body.ok) return body;
        return parseTask(body.value, taskId);
      } catch {
        return { ok: false, error: `Todoist could not load task ${taskId}.` };
      }
    },
    async closeTask(taskId) {
      const token = tokenSource();
      if (!token) return { ok: false, error: "Todoist is not configured on this machine." };
      try {
        const res = await fetchImpl(`${TODOIST_API}/tasks/${encodeURIComponent(taskId)}/close`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 204 || res.ok) return { ok: true, value: true };
        if (res.status === 404) return { ok: false, error: `Todoist has no task ${taskId}.` };
        return { ok: false, error: `Todoist could not complete that task (${res.status}).` };
      } catch {
        return { ok: false, error: `Todoist could not complete task ${taskId}.` };
      }
    },
  };
}

export async function validateTodoistToken(token: string, fetchImpl: FetchLike = fetch): Promise<Result<true, string>> {
  if (!token.trim()) return { ok: false, error: "A Todoist API token is required." };
  try {
    const res = await fetchImpl(`${TODOIST_API}/user`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, value: true };
    if (res.status === 401 || res.status === 403 || res.status === 412) {
      return { ok: false, error: "Todoist rejected that API token." };
    }
    return { ok: false, error: `Todoist could not validate that token (${res.status}).` };
  } catch {
    return { ok: false, error: "Todoist could not validate that token." };
  }
}

export function parseTask(body: string, fallbackId: string): Result<TodoistTaskView, string> {
  let decoded: object;
  try {
    decoded = JSON.parse(body);
  } catch {
    return { ok: false, error: "Todoist returned a task that could not be read." };
  }
  const parsed = TodoistTaskResponse.safeParse(decoded);
  if (!parsed.success) return { ok: false, error: "Todoist returned a task that could not be read." };
  const id = String(parsed.data.id);
  if (id !== fallbackId) return { ok: false, error: `Todoist returned a different task than ${fallbackId}.` };
  return {
    ok: true,
    value: {
      id,
      content: parsed.data.content,
      isCompleted: parsed.data.is_completed === true || parsed.data.checked === true,
      url: parsed.data.url ?? null,
      due: parsed.data.due?.date ?? null,
    },
  };
}

export async function loadTodoistTasks(
  taskIds: string[],
  client: TodoistClient,
): Promise<{ tasks: TodoistTaskView[]; errors: string[] }> {
  const loaded = await Promise.all(
    taskIds.map(async (taskId) => {
      const result = await client.getTask(taskId);
      if (result.ok) return { task: result.value, error: null };
      return {
        task: {
          id: taskId,
          content: result.error.slice(0, UI_LIMITS.content),
          isCompleted: false,
          url: null,
          due: null,
          unavailable: true,
        } satisfies TodoistTaskView,
        error: result.error,
      };
    }),
  );
  return {
    tasks: loaded.map((entry) => entry.task),
    errors: loaded.flatMap((entry) => (entry.error ? [entry.error] : [])),
  };
}
