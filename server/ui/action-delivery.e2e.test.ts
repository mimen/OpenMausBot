import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { ComponentActionEvent } from "./contract.ts";

const serverDir = dirname(fileURLToPath(import.meta.url));
const root = join(serverDir, "..", "..");
const fakeCli = join(root, "server", "testing", "fake-acp-cli.ts");
const port = 21500 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
let home: string;
let gate: string;
let stderr = "";

const JsonObjectResponse = z.record(z.string(), z.json());
const BotSnapshotSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  busy: z.boolean().optional(),
  messages: z.array(z.object({ text: z.string().optional() }).passthrough()),
}).passthrough();
const GroupSnapshotSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  busyBotId: z.string().nullable().optional(),
  messages: z.array(z.object({ text: z.string().optional() }).passthrough()),
}).passthrough();
const BotsResponseSchema = z.object({
  bots: z.array(BotSnapshotSchema),
  groups: z.array(GroupSnapshotSchema).optional(),
});
const CreatedGroupResponseSchema = z.object({
  group: z.object({ id: z.string(), threadId: z.string() }).passthrough(),
});
type BotSnapshot = z.infer<typeof BotSnapshotSchema>;
type GroupSnapshot = z.infer<typeof GroupSnapshotSchema>;
type ApiRequestBody = z.input<typeof JsonObjectResponse>;

async function api(method: string, path: string, body?: ApiRequestBody) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: JsonObjectResponse.parse(await response.json()) };
}

async function botSnapshots(): Promise<BotSnapshot[]> {
  return BotsResponseSchema.parse((await api("GET", "/api/bots")).body).bots;
}

async function groupSnapshots(): Promise<GroupSnapshot[]> {
  return BotsResponseSchema.parse((await api("GET", "/api/bots")).body).groups ?? [];
}

async function until(probe: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (await probe()) return;
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`${message}: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "openmaus-action-delivery-"));
  gate = join(home, "echo.gate");
  writeFileSync(gate, "open");
  mkdirSync(join(home, ".openmausbot"), { recursive: true });
  writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({
    instances: {
      delivery: {
        driver: "grokAgent",
        environment: { FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: gate },
        config: { cli: fakeCli, fullAuto: true },
      },
    },
  }));
  child = spawn(process.execPath, ["--experimental-strip-types", join(root, "server", "index.ts")], {
    cwd: root,
    env: { HOME: home, USERPROFILE: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), PATH: process.env.PATH },
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

describe("durable action event provider delivery", () => {
  it("injects once into a resumed provider context and records the exact provider cursor", async () => {
    const bots = await botSnapshots();
    const bot = bots[0];
    if (!bot) throw new Error("the isolated server created no bot");
    await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "delivery", model: "fake-model" },
    });
    const event: ComponentActionEvent = {
      actionId: "action-delivery-1",
      idempotencyKey: "delivery:key:1",
      threadId: bot.threadId,
      callId: "call-delivery-1",
      botId: bot.id,
      componentName: "show_status_board",
      actionName: "resolve_item",
      entity: { id: "finding-1", label: "Resolved finding" },
      result: { summary: "Resolved the finding locally." },
      status: "succeeded",
      trustedOrigin: "same_origin_browser",
      createdAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:01.000Z",
      deliveryCursors: {},
      execution: { attempt: 1 },
      followUp: { status: "dispatched", attempt: 1, dispatchedAt: "2026-08-20T12:00:02.000Z" },
    };
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

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "What changed?" })).status).toBe(202);
    let snapshot: BotSnapshot | undefined;
    await until(async () => {
      snapshot = (await botSnapshots()).find((candidate) => candidate.id === bot.id);
      return Boolean(snapshot && !snapshot.busy && snapshot.messages.some((message) => message.text?.startsWith("echo: ")));
    }, "first echo did not settle");
    if (!snapshot) throw new Error("first delivery snapshot is unavailable");
    const firstEcho = snapshot.messages.filter((message) => message.text?.startsWith("echo: ")).at(-1)?.text ?? "";
    expect(firstEcho).toContain("OpenMaus trusted component action events");
    expect(firstEcho).toContain("Resolved the finding locally.");

    const checked = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
    // SAFETY: this test query selects the declared provider_cursor TEXT column.
    const delivery = checked.prepare("SELECT provider_cursor FROM component_action_deliveries WHERE action_id = ?")
      .get(event.actionId) as { provider_cursor: string };
    checked.close();
    expect(delivery.provider_cursor).toBe("grokAgent:delivery");

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "And now?" })).status).toBe(202);
    await until(async () => {
      snapshot = (await botSnapshots()).find((candidate) => candidate.id === bot.id);
      return Boolean(snapshot && !snapshot.busy && snapshot.messages.filter((message) => message.text?.startsWith("echo: ")).length >= 2);
    }, "second echo did not settle");
    if (!snapshot) throw new Error("second delivery snapshot is unavailable");
    const secondEcho = snapshot.messages.filter((message) => message.text?.startsWith("echo: ")).at(-1)?.text ?? "";
    expect(secondEcho).not.toContain("OpenMaus trusted component action events");
  });

  it("coalesces a busy thread's action batch into one inferred follow-up turn", async () => {
    const bot = (await botSnapshots())[0];
    if (!bot) throw new Error("the isolated server created no bot");
    const before = bot.messages.filter((message) => message.text?.startsWith("echo: ")).length;
    const database = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
    for (let index = 0; index < 2; index += 1) {
      const event: ComponentActionEvent = {
        actionId: `batch-action-${index}`,
        idempotencyKey: `batch:key:${index}`,
        threadId: bot.threadId,
        callId: `batch-call-${index}`,
        botId: bot.id,
        componentName: "show_supplement_stack",
        actionName: "tick_item",
        entity: { id: `item-${index}`, label: `Supplement ${index}` },
        result: { summary: `Checked supplement ${index}.` },
        status: "succeeded",
        trustedOrigin: "same_origin_browser",
        createdAt: `2026-08-20T12:0${index}:00.000Z`,
        updatedAt: `2026-08-20T12:0${index}:01.000Z`,
        deliveryCursors: {},
        execution: { attempt: 1 },
        followUp: { status: "pending", attempt: 0 },
      };
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
    }
    database.close();

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Process the action batch." })).status).toBe(202);
    let snapshot: BotSnapshot | undefined;
    await until(async () => {
      snapshot = (await botSnapshots()).find((candidate) => candidate.id === bot.id);
      const echoes = snapshot?.messages.filter((message) => message.text?.startsWith("echo: ")).length ?? 0;
      return Boolean(snapshot && !snapshot.busy && echoes >= before + 2);
    }, "batched inferred follow-up did not settle");
    await new Promise((resolve) => setTimeout(resolve, 300));
    snapshot = (await botSnapshots()).find((candidate) => candidate.id === bot.id);
    const replies = snapshot?.messages.filter((message) => message.text?.startsWith("echo: ")).slice(before) ?? [];
    expect(replies).toHaveLength(2);
    expect(replies[1]?.text).toContain("2 trusted UI actions");

    const checked = new DatabaseSync(join(home, ".openmausbot", "messages.db"));
    // SAFETY: this test query selects the indexed follow-up status for the two batch rows.
    const rows = checked.prepare(
      "SELECT follow_up_status FROM component_action_events WHERE action_id LIKE 'batch-action-%' ORDER BY action_id",
    ).all() as Array<{ follow_up_status: string }>;
    checked.close();
    expect(rows.map((row) => row.follow_up_status)).toEqual(["dispatched", "dispatched"]);
  });

  it("routes a room component action back to the member that rendered it", async () => {
    const bot = (await botSnapshots())[0];
    if (!bot) throw new Error("the isolated server created no bot");
    const created = CreatedGroupResponseSchema.parse((await api("POST", "/api/groups", {
      name: "Action room",
      memberIds: [bot.id],
    })).body).group;
    const event: ComponentActionEvent = {
      actionId: "room-action-1",
      idempotencyKey: "room:key:1",
      threadId: created.threadId,
      callId: "room-call-1",
      botId: bot.id,
      componentName: "show_week_calendar",
      actionName: "approve_proposal",
      entity: { id: "proposal-1", label: "Week proposal" },
      result: { summary: "Approved the proposal locally." },
      status: "succeeded",
      trustedOrigin: "same_origin_browser",
      createdAt: "2026-08-20T13:00:00.000Z",
      updatedAt: "2026-08-20T13:00:01.000Z",
      deliveryCursors: {},
      execution: { attempt: 1 },
      followUp: { status: "pending", attempt: 0 },
    };
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

    expect((await api("POST", `/api/groups/${created.id}/messages`, { text: "Process the room action." })).status).toBe(202);
    let room: GroupSnapshot | undefined;
    await until(async () => {
      room = (await groupSnapshots()).find((candidate) => candidate.id === created.id);
      const echoes = room?.messages.filter((message) => message.text?.startsWith("echo: ")).length ?? 0;
      return Boolean(room && !room.busyBotId && echoes >= 2);
    }, "room action follow-up did not settle");
    const replies = room?.messages.filter((message) => message.text?.startsWith("echo: ")) ?? [];
    expect(replies).toHaveLength(2);
    expect(replies[1]?.text).toContain("1 trusted UI action");
  });
});
