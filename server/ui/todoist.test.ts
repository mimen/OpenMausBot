import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { capturedTodoistToken, liveTodoistClient, parseTask, validateTodoistToken, type FetchLike } from "./todoist.ts";
import { UI_LIMITS } from "./contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, "fixtures", name), "utf8");

function response(status: number, body = "") {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

describe("Todoist HTTP client contract", () => {
  it("replays recorded checked and unchecked task fixtures", () => {
    expect(parseTask(fixture("todoist-task-a.json"), "6hJCfm66Hh5Q4wqv")).toMatchObject({
      ok: true,
      value: { id: "6hJCfm66Hh5Q4wqv", isCompleted: true },
    });
    expect(parseTask(fixture("todoist-task-b.json"), "6hJCfmGxJHcvjQRM")).toMatchObject({
      ok: true,
      value: { id: "6hJCfmGxJHcvjQRM", isCompleted: false },
    });
  });

  it("uses exact v1 task and close endpoints with bearer auth", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) =>
      init?.method === "POST" ? response(204) : response(200, fixture("todoist-task-b.json")),
    );
    const client = liveTodoistClient(() => "secret", fetchImpl);
    await expect(client.getTask("6hJCfmGxJHcvjQRM")).resolves.toMatchObject({ ok: true });
    await expect(client.closeTask("6hJCfmGxJHcvjQRM")).resolves.toEqual({ ok: true, value: true });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.todoist.com/api/v1/tasks/6hJCfmGxJHcvjQRM");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.todoist.com/api/v1/tasks/6hJCfmGxJHcvjQRM/close");
    for (const [, init] of fetchImpl.mock.calls) expect(init?.headers).toEqual({ Authorization: "Bearer secret" });
  });

  it("enriches task rows with the native Todoist project name", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.endsWith("/projects/project-1")) return response(200, JSON.stringify({ id: "project-1", name: "Health" }));
      return response(200, JSON.stringify({
        id: "task-1",
        content: "Request labs",
        description: "25-OH vitamin D and homocysteine",
        project_id: "project-1",
        labels: ["labs"],
        comment_count: 1,
        checked: false,
        due: { date: "2026-06-30" },
      }));
    });
    const client = liveTodoistClient(() => "secret", fetchImpl);
    await expect(client.getTask("task-1")).resolves.toMatchObject({
      ok: true,
      value: {
        description: "25-OH vitamin D and homocysteine",
        projectName: "Health",
        labels: ["labs"],
        commentCount: 1,
      },
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.todoist.com/api/v1/tasks/task-1",
      "https://api.todoist.com/api/v1/projects/project-1",
    ]);
  });

  it("preserves recurring due state and reads completed-task history for crash recovery", async () => {
    expect(parseTask(JSON.stringify({
      id: "task-1",
      content: "Recurring task",
      checked: false,
      due: { date: "2026-08-20", is_recurring: true },
    }), "task-1")).toMatchObject({ ok: true, value: { recurring: true, due: "2026-08-20" } });

    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes("cursor=next")) {
        return response(200, JSON.stringify({ items: [{ id: "task-1", completed_at: "2026-08-20T12:01:00Z" }], next_cursor: null }));
      }
      return response(200, JSON.stringify({ items: [], next_cursor: "next" }));
    });
    const client = liveTodoistClient(() => "secret", fetchImpl);
    await expect(client.wasCompleted?.("task-1", "2026-08-20T12:00:00Z")).resolves.toEqual({ ok: true, value: true });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/tasks/completed/by_completion_date?since=");
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("cursor=next");
  });

  it("validates tokens through the authenticated user endpoint", async () => {
    const accepted = vi.fn<FetchLike>(async () => response(200, "{}"));
    await expect(validateTodoistToken("accepted", accepted)).resolves.toEqual({ ok: true, value: true });
    expect(accepted.mock.calls[0]?.[0]).toBe("https://api.todoist.com/api/v1/user");
    const rejected = vi.fn<FetchLike>(async () => response(401, "{}"));
    await expect(validateTodoistToken("rejected", rejected)).resolves.toEqual({ ok: false, error: "Todoist rejected that API token." });
  });

  it("stops reading an oversized streaming response", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(70 * 1024));
          controller.close();
        },
      }),
      text: async () => { throw new Error("streaming path expected"); },
    }));
    const client = liveTodoistClient(() => "secret", fetchImpl);
    await expect(client.getTask("task")).resolves.toEqual({ ok: false, error: "Todoist returned an oversized response." });
  });

  it("rejects oversized valid JSON before it reaches a renderer", () => {
    const body = JSON.stringify({
      id: "task",
      content: "x".repeat(UI_LIMITS.content + 1),
      checked: false,
      url: null,
      due: null,
    });
    expect(parseTask(body, "task")).toEqual({ ok: false, error: "Todoist returned a task that could not be read." });
  });

  it("captures then removes the ambient token", () => {
    const env = { TODOIST_API_TOKEN: " secret ", PATH: "/bin" };
    expect(capturedTodoistToken(env)).toBe("secret");
    expect(env).toEqual({ PATH: "/bin" });
  });
});
