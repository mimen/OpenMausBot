import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const serverDir = dirname(fileURLToPath(import.meta.url));
const root = join(serverDir, "..", "..");
const port = 20500 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let home: string;
let stderr = "";

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "openmaus-action-boundary-"));
  mkdirSync(join(home, ".openmausbot"), { recursive: true });
  writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({ instances: {} }));
  child = spawn(process.execPath, ["--experimental-strip-types", join(root, "server", "index.ts")], {
    cwd: root,
    env: {
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(port),
      OMB_WEBHOOK_PORT: String(port + 1),
      OMB_DESKTOP_ACTION_TOKEN: "test-desktop-action-token-0123456789",
      PATH: process.env.PATH,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  await waitForServer();
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("component action HTTP boundaries", () => {
  it("fails the Electron route closed when the dedicated bearer is missing", async () => {
    const response = await fetch(`${base}/api/internal/ui/desktop/todoist/begin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread", callId: "call", taskId: "task" }),
    });
    expect(response.status).toBe(401);
  });

  it("admits only the dedicated desktop token before checking the component claim", async () => {
    const response = await fetch(`${base}/api/internal/ui/desktop/todoist/begin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-desktop-action-token-0123456789",
      },
      body: JSON.stringify({ threadId: "thread", callId: "call", taskId: "task" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "That component call is not in this thread." });
  });

  it("requires a browser Origin and non-simple JSON for local ledger writes", async () => {
    const body = JSON.stringify({
      actionId: "3a58a7e8-3ce0-4cb8-b172-f6ce0948e6ce",
      threadId: "thread",
      callId: "call",
      itemId: "item",
      date: "2026-08-20",
      checked: true,
    });
    const missingOrigin = await fetch(`${base}/api/ui/supplements/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(missingOrigin.status).toBe(403);
    const foreignOrigin = await fetch(`${base}/api/ui/supplements/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body,
    });
    expect(foreignOrigin.status).toBe(403);
    const form = await fetch(`${base}/api/ui/supplements/toggle`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: `http://127.0.0.1:${port}` },
      body,
    });
    expect(form.status).toBe(415);
  });
});
