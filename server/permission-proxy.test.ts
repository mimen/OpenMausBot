// Contract test for the permission proxy's ask classification. The CLI
// routes BOTH permission asks and its built-in AskUserQuestion through
// this one MCP tool (`approve`), so the thing worth pinning to the wire
// is which transport ask each becomes:
//
//   Bash approve        → permission-kind (grant-eligible)
//   AskUserQuestion     → QUESTION-kind, never grant-eligible, and the
//                         human's selections ride back inside the
//                         allow contract as updatedInput.answers
//   ask_user            → question-kind, words verbatim
//
// A mislabeled question here is how auto mode once answered FOR the user
// (the "auto-approved AskUserQuestion" incident), so the classification
// itself is the regression under test — exercised through the spawned
// process, not a reimplementation.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROXY = new URL("./permission-proxy.ts", import.meta.url).pathname;

describe("permission proxy ask classification (fake broker)", () => {
  let broker: Server;
  let proxy: ChildProcess;
  let socketPath = "";
  let buf = "";
  const asks: any[] = [];
  let notifyAsk: (() => void) | null = null;
  let conn: import("node:net").Socket | null = null;

  const rpc = (msg: unknown) => proxy.stdin!.write(JSON.stringify(msg) + "\n");
  const results = new Map<number, any>();
  const waitFor = async (id: number, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (results.has(id)) return results.get(id);
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no MCP response for id ${id}`);
  };
  /** Resolve the oldest unresolved ask with a broker answer frame. */
  const resolveAsk = (answer: Record<string, unknown>) => {
    const ask = asks.at(-1);
    conn!.write(JSON.stringify({ t: "answer", id: ask.id, ...answer }) + "\n");
    return ask;
  };
  const nextAsk = async () => {
    const seen = asks.length;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (asks.length > seen) return asks[seen];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("broker never received the ask");
  };

  beforeAll(async () => {
    socketPath = join(mkdtempSync(join(tmpdir(), "omb-permproxy-")), "broker.sock");
    broker = createServer((c) => {
      conn = c;
      let b = "";
      c.on("data", (chunk) => {
        b += chunk;
        let nl;
        while ((nl = b.indexOf("\n")) !== -1) {
          const line = b.slice(0, nl);
          b = b.slice(nl + 1);
          try {
            const msg = JSON.parse(line);
            if (msg.t === "ask") {
              asks.push(msg);
              notifyAsk?.();
              notifyAsk = null;
            }
          } catch {}
        }
      });
    });
    await new Promise<void>((r) => broker.listen(socketPath, r));

    proxy = spawn(process.execPath, ["--experimental-strip-types", PROXY, socketPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    proxy.stdout!.on("data", (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && msg.result) results.set(msg.id, msg.result);
        } catch {}
      }
    });
    rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await waitFor(1);
  }, 20_000);

  afterAll(() => {
    proxy?.kill();
    broker?.close();
  });

  const QUESTIONS_INPUT = {
    questions: [
      {
        question: "Revert the 13 task moves?",
        header: "Moves",
        options: [{ label: "Keep them" }, { label: "Revert them" }],
        multiSelect: false,
      },
      {
        question: "Anything else?",
        options: [{ label: "No" }],
        multiSelect: false,
      },
    ],
  };

  it("classifies an AskUserQuestion approve call as a QUESTION, never a permission", async () => {
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTIONS_INPUT } } });
    const ask = await nextAsk();

    expect(ask.kind).toBe("question");
    expect(ask.tool).toBe("AskUserQuestion");
    // card text joins every question; choices come from the first one
    expect(ask.input.question).toBe("Revert the 13 task moves? · Anything else?");
    expect(ask.input.choices).toEqual(["Keep them", "Revert them"]);

    // the human answers → allow WITH their selections injected per question
    resolveAsk({ behavior: "answer", message: "Revert them" });
    const result = await waitFor(2);
    expect(JSON.parse(result.content[0].text)).toEqual({
      behavior: "allow",
      updatedInput: {
        ...QUESTIONS_INPUT,
        answers: { "Revert the 13 task moves?": "Revert them", "Anything else?": "Revert them" },
      },
    });
  });

  it("denies an unanswered AskUserQuestion instead of fabricating consent", async () => {
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "approve", arguments: { tool_name: "AskUserQuestion", input: QUESTIONS_INPUT } } });
    await nextAsk();

    // what the broker sends when nobody answers in time
    resolveAsk({ behavior: "answer", message: "OpenMausBot: nobody answered in time. Use your best judgment and continue." });
    const result = await waitFor(3);
    const decision = JSON.parse(result.content[0].text);
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("nobody answered in time");
  });

  it("leaves an ordinary permission ask permission-kind, contract unchanged", async () => {
    rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "approve", arguments: { tool_name: "Bash", input: { command: "git status" } } } });
    const ask = await nextAsk();

    expect(ask.kind).toBeUndefined();
    expect(ask.tool).toBe("Bash");

    resolveAsk({ behavior: "allow" });
    const result = await waitFor(4);
    expect(JSON.parse(result.content[0].text)).toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
    });
  });

  it("still carries ask_user verbatim", async () => {
    rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ask_user", arguments: { question: "Which branch?" } } });
    const ask = await nextAsk();

    expect(ask.kind).toBe("question");
    expect(ask.tool).toBe("ask_user");

    resolveAsk({ behavior: "answer", message: "main" });
    const result = await waitFor(5);
    expect(result.content[0].text).toBe("main");
  });
});
