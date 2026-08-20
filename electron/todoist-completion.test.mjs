import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { appendTodoistCompletionReceipt, closeTodoistTask, completionKey, resolveServerPort, TodoistCompletionGate } from "./todoist-completion.mjs";

describe("resolveServerPort", () => {
  it("uses the configured development server port", () => {
    expect(resolveServerPort("18879")).toBe(18879);
  });

  it("falls back for missing, malformed, or out-of-range ports", () => {
    expect(resolveServerPort(undefined)).toBe(8799);
    expect(resolveServerPort("not-a-port")).toBe(8799);
    expect(resolveServerPort("0")).toBe(8799);
    expect(resolveServerPort("65536")).toBe(8799);
  });
});

describe("TodoistCompletionGate", () => {
  it("consumes before await so parallel and repeated clicks issue one remote close", async () => {
    const gate = new TodoistCompletionGate();
    const key = completionKey({ threadId: "t", callId: "c", taskId: "a" });
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let closes = 0;
    const first = gate.run(key, async () => {
      closes++;
      await pending;
      return "closed";
    });
    const parallel = gate.run(key, async () => {
      closes++;
      return "duplicate";
    });
    await expect(parallel).rejects.toThrow("already requested");
    expect(closes).toBe(1);
    release();
    await expect(first).resolves.toBe("closed");
    await expect(gate.run(key, async () => "repeat")).rejects.toThrow("already requested");
    expect(closes).toBe(1);
  });

  it("restores retryability only after the remote action fails", async () => {
    const gate = new TodoistCompletionGate();
    let attempts = 0;
    const action = async () => {
      attempts++;
      if (attempts === 1) throw new Error("network failed");
      return "closed";
    };
    await expect(gate.run("key", action)).rejects.toThrow("network failed");
    await expect(gate.run("key", action)).resolves.toBe("closed");
    await expect(gate.run("key", action)).rejects.toThrow("already requested");
    expect(attempts).toBe(2);
  });

  it("writes the trusted accepted receipt only after one consumed close", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-electron-receipt-"));
    try {
      const payload = { threadId: "thread", callId: "call", taskId: "task" };
      const gate = new TodoistCompletionGate();
      await gate.run(completionKey(payload), async () => undefined);
      appendTodoistCompletionReceipt(dir, payload, "2026-08-20T12:00:00.000Z");
      await expect(gate.run(completionKey(payload), async () => undefined)).rejects.toThrow("already requested");
      const rows = readFileSync(join(dir, "ui-actions.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toEqual([
        expect.objectContaining({
          kind: "complete-accepted",
          taskId: "task",
          detail: "Todoist close returned success through Electron IPC",
        }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("closeTodoistTask HTTP contract", () => {
  it("uses the exact v1 close endpoint and bearer token", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    await closeTodoistTask("secret", "task/a", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.todoist.com/api/v1/tasks/task%2Fa/close",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer secret" } }),
    );
  });
});
