// Generative UI MCP proxy, spawned inside any provider turn that supports
// stdio MCP. It exposes one tool per compiled gallery component. Showing a
// component records the call in the harness; it never completes a Todoist task.
import readline from "node:readline";
import { z } from "zod";

import type { JsonObject } from "../contracts.ts";
import { GALLERY } from "../ui/gallery.ts";

const HARNESS = process.env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799";
const TOKEN = process.env.OMB_COMMS_TOKEN ?? "";
const BOT_ID = process.env.OMB_BOT_ID ?? "";
const THREAD_ID = process.env.OMB_THREAD_ID ?? "";
const RpcId = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const RpcParams = z.record(z.string(), z.json());
const RpcMessage = z.object({
  id: RpcId.optional(),
  method: z.string(),
  params: RpcParams.optional(),
});
const ApiResponse = z.record(z.string(), z.json());
const STRING = z.string();

const TOOLS = GALLERY.map((spec) => ({
  name: spec.name,
  description: spec.description,
  inputSchema: spec.parameters,
}));

type RpcIdValue = z.infer<typeof RpcId>;
type RpcMessageValue = z.infer<typeof RpcMessage>;

function ok(id: RpcIdValue, result: JsonObject): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function rpcErr(id: RpcIdValue, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function textResult(id: RpcIdValue, text: string, isError = false): void {
  ok(id, { content: [{ type: "text", text }], isError });
}

function stringValue(value: JsonObject[string]): string | null {
  const parsed = STRING.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function api(path: string, init?: RequestInit): Promise<JsonObject> {
  const res = await fetch(HARNESS + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...init?.headers },
  });
  const decoded = await res.json().catch(() => null);
  const parsed = ApiResponse.safeParse(decoded);
  const body = parsed.success ? parsed.data : {};
  if (!res.ok) throw new Error(stringValue(body.error) ?? `HTTP ${res.status}`);
  return body;
}

async function callTool(name: string, args: JsonObject): Promise<{ text: string; isError?: boolean }> {
  if (!TOOLS.some((tool) => tool.name === name)) return { text: `Unknown tool: ${name}`, isError: true };
  if (!BOT_ID || !THREAD_ID) return { text: "This UI tool has no bot or thread to draw into.", isError: true };
  const response = await api("/api/internal/ui/show", {
    method: "POST",
    body: JSON.stringify({ botId: BOT_ID, threadId: THREAD_ID, name, arguments: args }),
  });
  return { text: stringValue(response.result) ?? "It is now on screen for the person." };
}

async function handle(message: RpcMessageValue): Promise<void> {
  const { id, method } = message;
  const params = message.params ?? {};
  switch (method) {
    case "initialize":
      if (id === undefined) return;
      ok(id, {
        protocolVersion: stringValue(params.protocolVersion) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-ui", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      if (id === undefined) return;
      ok(id, {});
      return;
    case "tools/list":
      if (id === undefined) return;
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      if (id === undefined) return;
      const name = stringValue(params.name) ?? "";
      if (!TOOLS.some((tool) => tool.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      try {
        const parsedArgs = RpcParams.safeParse(params.arguments);
        const args = parsedArgs.success ? parsedArgs.data : {};
        const { text, isError } = await callTool(name, args);
        textResult(id, text, isError);
      } catch (error) {
        textResult(id, error instanceof Error ? error.message : String(error), true);
      }
      return;
    }
    default:
      if (id !== undefined && id !== null) rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let decoded: object;
  try {
    decoded = JSON.parse(text);
  } catch {
    return;
  }
  const parsed = RpcMessage.safeParse(decoded);
  if (!parsed.success) return;
  void handle(parsed.data).catch((error) => {
    if (parsed.data.id !== undefined && parsed.data.id !== null) {
      rpcErr(parsed.data.id, -32603, error instanceof Error ? error.message : String(error));
    }
  });
});
rl.on("close", () => process.exit(0));
