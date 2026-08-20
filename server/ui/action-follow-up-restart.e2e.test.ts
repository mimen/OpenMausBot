import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { ComponentActionEvent } from "./contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fakeCli = join(root, "server", "testing", "fake-acp-cli.ts");
const port = 22500 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${port}`;
const JsonResponseSchema = z.record(z.string(), z.json());
const BotSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  busy: z.boolean().optional(),
  messages: z.array(z.object({ text: z.string().optional() }).passthrough()),
}).passthrough();
const BotsSchema = z.object({ bots: z.array(BotSchema) });
const GroupSchema = z.object({ group: z.object({ id: z.string(), threadId: z.string() }).passthrough() });

type BotSnapshot = z.infer<typeof BotSchema>;
type RequestBody = z.input<typeof JsonResponseSchema>;

let child: ChildProcess | null = null;
let home = "";
let stderr = "";

async function api(method: string, path: string, body?: RequestBody): Promise<z.infer<typeof JsonResponseSchema>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}`);
  return JsonResponseSchema.parse(await response.json());
}

async function until(probe: () => Promise<boolean> | boolean, message: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (await probe()) return;
    if (child?.exitCode !== null) throw new Error(`server exited ${child?.exitCode}: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`${message}: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function startServer(): Promise<void> {
  stderr = "";
  child = spawn(process.execPath, ["--experimental-strip-types", join(root, "server", "index.ts")], {
    cwd: root,
    env: {
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(port),
      OMB_WEBHOOK_PORT: String(port + 1),
      PATH: process.env.PATH,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  await until(async () => {
    try {
      return (await fetch(`${base}/api/health`)).ok;
    } catch {
      return false;
    }
  }, "server did not start");
}

async function stopServer(): Promise<void> {
  const running = child;
  child = null;
  if (!running || running.exitCode !== null) return;
  running.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    running.once("exit", () => resolve());
    setTimeout(() => {
      running.kill("SIGKILL");
      resolve();
    }, 3_000).unref?.();
  });
}

async function firstBot(): Promise<BotSnapshot> {
  const bot = BotsSchema.parse(await api("GET", "/api/bots")).bots[0];
  if (!bot) throw new Error("the isolated server created no bot");
  return bot;
}

function insertEvent(event: ComponentActionEvent): void {
  const database = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
  database.prepare(
    "INSERT INTO component_action_events (action_id, idempotency_key, thread_id, call_id, status, follow_up_status, follow_up_attempt, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    event.actionId,
    event.idempotencyKey,
    event.threadId,
    event.callId,
    event.status,
    event.followUp.status,
    event.followUp.attempt,
    event.updatedAt,
    JSON.stringify(event),
  );
  database.close();
}

function deliveryCount(actionId: string): number {
  const database = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
  // SAFETY: COUNT(*) returns one integer row for the requested action id.
  const row = database.prepare(
    "SELECT COUNT(*) AS count FROM component_action_deliveries WHERE action_id = ?",
  ).get(actionId) as { count: number };
  database.close();
  return row.count;
}

function followUpRow(actionId: string): { status: string; attempt: number } | null {
  const database = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
  // SAFETY: the query selects the declared TEXT status and INTEGER attempt columns.
  const row = database.prepare(
    "SELECT follow_up_status AS status, follow_up_attempt AS attempt FROM component_action_events WHERE action_id = ?",
  ).get(actionId) as { status: string; attempt: number } | undefined;
  database.close();
  return row ?? null;
}

afterAll(async () => {
  await stopServer();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("action follow-up restart recovery", () => {
  it("wakes a live startup lease and retries failed room providers without consuming the batch", async () => {
    home = mkdtempSync(join(tmpdir(), "openmaus-follow-up-restart-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({
      instances: {
        delivery: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "echo-gated" },
          config: { cli: fakeCli, fullAuto: true },
        },
        failing: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "turn-error" },
          config: { cli: fakeCli, fullAuto: true },
        },
      },
    }));

    await startServer();
    const bot = await firstBot();
    await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "delivery", model: "fake-model" },
    });
    await stopServer();

    const claimedUntil = new Date(Date.now() + 750).toISOString();
    insertEvent({
      actionId: "restart-live-claim",
      idempotencyKey: "restart:live:claim",
      threadId: bot.threadId,
      callId: "restart-call",
      botId: bot.id,
      componentName: "show_supplement_stack",
      actionName: "tick_item",
      entity: { id: "magnesium", label: "Magnesium" },
      result: { summary: "Checked Magnesium." },
      status: "succeeded",
      trustedOrigin: "same_origin_browser",
      createdAt: new Date(Date.now() - 1_000).toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryCursors: {},
      execution: { attempt: 1 },
      followUp: { status: "claimed", attempt: 1, claimedUntil },
    });

    await startServer();
    await until(() => followUpRow("restart-live-claim")?.status === "dispatched", "restored live claim did not dispatch");
    const restartedBot = await firstBot();
    expect(restartedBot.messages.some((message) => message.text?.includes("1 trusted UI action"))).toBe(true);

    const group = GroupSchema.parse(await api("POST", "/api/groups", {
      name: "Failed follow-up room",
      memberIds: [bot.id],
    })).group;
    await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "failing", model: "fake-model" },
    });
    await stopServer();

    insertEvent({
      actionId: "room-failed-follow-up",
      idempotencyKey: "room:failed:follow-up",
      threadId: group.threadId,
      callId: "room-failed-call",
      botId: bot.id,
      componentName: "show_week_calendar",
      actionName: "approve_proposal",
      entity: { id: "proposal-1", label: "Week proposal" },
      result: { summary: "Approved the proposal locally." },
      status: "succeeded",
      trustedOrigin: "same_origin_browser",
      createdAt: new Date(Date.now() - 1_000).toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryCursors: {},
      execution: { attempt: 1 },
      followUp: { status: "pending", attempt: 0 },
    });

    await startServer();
    await until(() => {
      const row = followUpRow("room-failed-follow-up");
      return row?.attempt === 3 && row.status === "failed";
    }, "failed room follow-up did not exhaust retries");
    expect(followUpRow("room-failed-follow-up")).toEqual({ status: "failed", attempt: 3 });
    expect(deliveryCount("room-failed-follow-up")).toBe(0);
  }, 60_000);
});
