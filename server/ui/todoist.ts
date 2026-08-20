import { z } from "zod";

import type { Result, TodoistTaskView } from "./contract.ts";
import { UI_LIMITS } from "./contract.ts";

const TODOIST_API = "https://api.todoist.com/api/v1";
const TodoistTaskResponse = z.object({
  id: z.union([z.string(), z.number()]),
  content: z.string().max(UI_LIMITS.content),
  description: z.string().max(UI_LIMITS.value).optional(),
  project_id: z.union([z.string(), z.number()]).nullable().optional(),
  labels: z.array(z.string().max(UI_LIMITS.label)).max(20).optional(),
  comment_count: z.number().int().nonnegative().max(10_000).nullable().optional(),
  is_completed: z.boolean().optional(),
  checked: z.boolean().optional(),
  url: z.string().max(UI_LIMITS.value).nullable().optional(),
  due: z.object({
    date: z.string().max(UI_LIMITS.label).nullable().optional(),
    is_recurring: z.boolean().optional(),
  }).nullable().optional(),
});

const TodoistCompletedResponse = z.object({
  items: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    completed_at: z.string().optional(),
  }).passthrough()).max(200),
  next_cursor: z.string().nullable().optional(),
});

const TodoistProjectResponse = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1).max(UI_LIMITS.label),
});

export type TodoistClient = {
  getTask: (taskId: string) => Promise<Result<TodoistTaskView, string>>;
  closeTask: (taskId: string) => Promise<Result<true, string>>;
  wasCompleted?: (taskId: string, since: string) => Promise<Result<boolean, string>>;
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
  const projectNames = new Map<string, Promise<string | null>>();
  const loadProjectName = (projectId: string): Promise<string | null> => {
    const existing = projectNames.get(projectId);
    if (existing) return existing;
    const pending = (async () => {
      const token = tokenSource();
      if (!token) return null;
      try {
        const response = await fetchImpl(`${TODOIST_API}/projects/${encodeURIComponent(projectId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return null;
        const body = await boundedResponseText(response);
        if (!body.ok) return null;
        const parsed = TodoistProjectResponse.safeParse(JSON.parse(body.value));
        if (!parsed.success || String(parsed.data.id) !== projectId) return null;
        return parsed.data.name;
      } catch {
        return null;
      }
    })();
    projectNames.set(projectId, pending);
    return pending;
  };

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
        const parsed = parseTask(body.value, taskId);
        if (!parsed.ok) return parsed;
        const projectName = parsed.value.projectId ? await loadProjectName(parsed.value.projectId) : null;
        return { ok: true, value: { ...parsed.value, projectName } };
      } catch {
        return { ok: false, error: `Todoist could not load task ${taskId}.` };
      }
    },
    async wasCompleted(taskId, since) {
      const token = tokenSource();
      if (!token) return { ok: false, error: "Todoist is not configured on this machine." };
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) return { ok: false, error: "The Todoist action timestamp is invalid." };
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const url = new URL(`${TODOIST_API}/tasks/completed/by_completion_date`);
        url.searchParams.set("since", sinceDate.toISOString());
        url.searchParams.set("until", new Date(Date.now() + 5 * 60_000).toISOString());
        if (cursor) url.searchParams.set("cursor", cursor);
        try {
          const response = await fetchImpl(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) return { ok: false, error: `Todoist could not read completed tasks (${response.status}).` };
          const body = await boundedResponseText(response);
          if (!body.ok) return body;
          const parsed = TodoistCompletedResponse.safeParse(JSON.parse(body.value));
          if (!parsed.success) return { ok: false, error: "Todoist returned completed tasks that could not be read." };
          if (parsed.data.items.some((item) => String(item.id) === taskId)) return { ok: true, value: true };
          cursor = parsed.data.next_cursor ?? null;
          if (!cursor) return { ok: true, value: false };
        } catch {
          return { ok: false, error: "Todoist could not read completed tasks." };
        }
      }
      return { ok: false, error: "Todoist completed-task history exceeded the recovery page limit." };
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
      description: parsed.data.description?.trim() || null,
      isCompleted: parsed.data.is_completed === true || parsed.data.checked === true,
      url: parsed.data.url ?? null,
      due: parsed.data.due?.date ?? null,
      recurring: parsed.data.due?.is_recurring === true,
      projectId: parsed.data.project_id == null ? null : String(parsed.data.project_id),
      projectName: null,
      labels: parsed.data.labels ?? [],
      commentCount: parsed.data.comment_count ?? 0,
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
          description: null,
          isCompleted: false,
          url: null,
          due: null,
          projectId: null,
          projectName: null,
          labels: [],
          commentCount: 0,
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
