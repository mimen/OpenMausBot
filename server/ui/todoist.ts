import { z } from "zod";

import type { Result, TodoistTaskView } from "./contract.ts";

const TODOIST_API = "https://api.todoist.com/api/v1";
const TodoistTaskResponse = z.object({
  id: z.union([z.string(), z.number()]),
  content: z.string(),
  is_completed: z.boolean().optional(),
  checked: z.boolean().optional(),
  url: z.string().nullable().optional(),
  due: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
});

export type TodoistClient = {
  getTask: (taskId: string) => Promise<Result<TodoistTaskView, string>>;
  closeTask: (taskId: string) => Promise<Result<true, string>>;
};

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export function todoistToken(env: { [key: string]: string | undefined } = process.env): string | null {
  const token = env.TODOIST_API_TOKEN?.trim();
  return token ? token : null;
}

export function liveTodoistClient(env: { [key: string]: string | undefined } = process.env, fetchImpl: FetchLike = fetch): TodoistClient {
  return {
    async getTask(taskId) {
      const token = todoistToken(env);
      if (!token) return { ok: false, error: "Todoist is not configured on this machine." };
      try {
        const res = await fetchImpl(`${TODOIST_API}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        const body = await res.text();
        if (res.status === 404) return { ok: false, error: `Todoist has no task ${taskId}.` };
        if (!res.ok) return { ok: false, error: `Todoist could not load that task (${res.status}).` };
        return parseTask(body, taskId);
      } catch {
        return { ok: false, error: `Todoist could not load task ${taskId}.` };
      }
    },
    async closeTask(taskId) {
      const token = todoistToken(env);
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

function parseTask(body: string, fallbackId: string): Result<TodoistTaskView, string> {
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
          content: result.error,
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
