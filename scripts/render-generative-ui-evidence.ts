import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const TASK_A = "6hJCfm66Hh5Q4wqv";
const TASK_B = "6hJCfmGxJHcvjQRM";
const sourceDir = process.env.OMB_EVIDENCE_DATA_DIR ?? "/private/tmp/openmaus-generative-ui-data";
const outputDir = join(import.meta.dirname, "..", "docs", "evidence", "generative-ui");
const replayDir = mkdtempSync(join(tmpdir(), "openmaus-ui-replay-"));
const token = process.env.TODOIST_API_TOKEN?.trim() ?? "";
delete process.env.TODOIST_API_TOKEN;

if (!token) throw new Error("TODOIST_API_TOKEN is required for read-only remote receipts");
cpSync(sourceDir, replayDir, { recursive: true });
process.env.OMB_DATA_DIR = replayDir;

const TaskResponse = z.object({
  id: z.union([z.string(), z.number()]),
  content: z.string(),
  checked: z.boolean().optional(),
  is_completed: z.boolean().optional(),
});
const Receipt = z.record(z.string(), z.json());
const ActionRow = z.object({
  at: z.string(),
  kind: z.string(),
  threadId: z.string(),
  callId: z.string(),
  name: z.string(),
  taskId: z.string().optional(),
  ok: z.boolean(),
});

async function remoteTask(taskId: string): Promise<z.infer<typeof TaskResponse>> {
  const response = await fetch(`https://api.todoist.com/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body: object = await response.json();
  if (!response.ok) throw new Error(`Todoist task ${taskId} returned HTTP ${response.status}`);
  return TaskResponse.parse(body);
}

function writeReceipt(name: string, value: z.infer<typeof Receipt>): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o644 });
}

try {
  const [{ Store }, { closeMessageDb }] = await Promise.all([
    import("../server/store.ts"),
    import("../server/message-db.ts"),
  ]);
  const store = new Store(() => ({ instanceId: "evidence", model: "replay" }));
  const replayed = store.bots
    .flatMap((bot) => store.tasks(bot.id).map((task) => ({ bot, task })))
    .flatMap(({ task }) => store.messagesFor(task.threadId))
    .find((message) => message.kind === "component")?.component;
  if (!replayed) throw new Error("isolated evidence database contains no component row");
  const serializedReplay = JSON.stringify(replayed);
  if (serializedReplay.includes("actionToken") || serializedReplay.includes("ombui_")) {
    throw new Error("replayed component still contains a completion capability");
  }

  const actions = readFileSync(join(replayDir, "ui-actions.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = ActionRow.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  const accepted = actions.find((row) => row.kind === "complete-accepted" && row.taskId === TASK_A);
  if (!accepted) throw new Error("isolated evidence log contains no accepted task A action");

  const [remoteA, remoteB] = await Promise.all([remoteTask(TASK_A), remoteTask(TASK_B)]);
  const capturedAt = new Date().toISOString();
  const remoteReceipt = (task: z.infer<typeof TaskResponse>) => ({
    capturedAt,
    source: `GET https://api.todoist.com/api/v1/tasks/${task.id}`,
    task: {
      id: String(task.id),
      content: task.content,
      checked: task.checked === true || task.is_completed === true,
    },
  });
  writeReceipt("remote-task-a.json", remoteReceipt(remoteA));
  writeReceipt("remote-task-b.json", remoteReceipt(remoteB));
  writeReceipt("accepted-ui-action.json", {
    capturedAt,
    historical: true,
    source: "isolated ui-actions.ndjson from the pre-hardening run",
    action: accepted,
    provenance:
      "This proves only that the earlier application recorded a successful action-path result. It does not exercise the hardened Electron IPC path or independently establish who initiated the renderer request.",
    currentFlowCoverage: [
      "electron/todoist-completion.test.mjs",
      "server/ui/show.test.ts",
      "server/ui/replay.test.ts",
    ],
  });
  writeReceipt("restart-replay.json", {
    capturedAt,
    source: "current Store replay over a copy of the isolated SQLite evidence database",
    component: replayed,
    capabilityScan: { actionToken: false, ombuiPrefix: false },
    screenshots: [
      "docs/screenshots/generative-ui/03-task-a-completed.png",
      "docs/screenshots/generative-ui/04-replayed-after-restart.png",
      "docs/screenshots/generative-ui/05-accessible-replay.png",
    ],
  });
  closeMessageDb();
  console.log(`wrote sanitized generative UI receipts to ${outputDir}`);
} finally {
  rmSync(replayDir, { recursive: true, force: true });
}
