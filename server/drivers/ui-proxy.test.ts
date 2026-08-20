import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "ui-proxy.ts");
const TOKEN = "test-ui-token";

let stub: Server;
let stubPort = 0;
let lastAuth: string | undefined;
const ShowBody = z.object({
  botId: z.string().optional(),
  threadId: z.string().optional(),
  name: z.string().optional(),
  arguments: z.object({ taskIds: z.array(z.string()).optional() }).optional(),
});
const RpcResultSchema = z.object({
  id: z.number().optional(),
  result: z.object({
    tools: z.array(z.object({ name: z.string() })).optional(),
    content: z.array(z.object({ text: z.string() })).optional(),
    isError: z.boolean().optional(),
  }).optional(),
});

let lastShowBody: z.infer<typeof ShowBody> | null = null;
let child: ChildProcess;
type RpcResult = z.infer<typeof RpcResultSchema>;
const pending = new Map<number, (msg: RpcResult) => void>();
let nextId = 100;

function rpc(method: string, params?: { [key: string]: string | { [key: string]: string | string[] } }): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 10_000).unref?.();
  });
}

beforeAll(async () => {
  stub = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method === "POST" && req.url === "/api/internal/ui/show") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const parsed = ShowBody.safeParse(JSON.parse(data));
        lastShowBody = parsed.success ? parsed.data : null;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "The Todoist tasks are now on screen for the person." }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown" }));
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const address = z.object({ port: z.number() }).safeParse(stub.address());
  if (!address.success) throw new Error("stub server did not bind a TCP port");
  stubPort = address.data.port;
  child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      OMB_HARNESS_URL: `http://127.0.0.1:${stubPort}`,
      OMB_BOT_ID: "bot-ui",
      OMB_THREAD_ID: "thread-ui",
      OMB_COMMS_TOKEN: TOKEN,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  child.stdout!.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const parsed = RpcResultSchema.safeParse(JSON.parse(line));
      if (!parsed.success || parsed.data.id === undefined) continue;
      pending.get(parsed.data.id)?.(parsed.data);
      pending.delete(parsed.data.id);
    }
  });
});

afterAll(async () => {
  child?.kill();
  await new Promise<void>((r) => stub.close(() => r()));
});

describe("ui-proxy MCP surface", () => {
  it("lists compiled gallery tools including Todoist", async () => {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect(init.result).toBeTruthy();
    const list = await rpc("tools/list");
    const names = list.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("show_todoist_tasks");
    expect(names).toContain("show_record_card");
  });

  it("forwards a Todoist show call without completing anything", async () => {
    const res = await rpc("tools/call", {
      name: "show_todoist_tasks",
      arguments: { taskIds: ["6hJCfm66Hh5Q4wqv"] },
    });
    expect(res.result?.content?.[0]?.text).toContain("on screen");
    expect(lastAuth).toBe(`Bearer ${TOKEN}`);
    expect(lastShowBody).toMatchObject({
      botId: "bot-ui",
      threadId: "thread-ui",
      name: "show_todoist_tasks",
      arguments: { taskIds: ["6hJCfm66Hh5Q4wqv"] },
    });
  });
});
