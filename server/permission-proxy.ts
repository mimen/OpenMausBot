// permission-proxy — the MCP stdio server the claude CLI spawns for
// --permission-prompt-tool (ported from agentcal's runPermissionProxy;
// dedicated entry file, so there is no argv-dispatch fork-bomb hazard).
// Forwards each ask over a unix socket to the broker living in the
// OpenMausBot server and waits for the human's answer.
//
//   approve   — the CLI calls this for any tool use its permission mode
//               would deny; the answer is the --permission-prompt-tool
//               JSON contract ({behavior:"allow"|"deny", …}). The CLI's
//               built-in AskUserQuestion arrives here too — and is
//               re-labeled question-kind below, because no grant may
//               ever answer for the person.
//   ask_user  — the agent can pose a question mid-run and wait; the
//               human's words come back verbatim.
//
// stdout is the MCP channel — never console.log here.
import { connect } from "node:net";
import { randomUUID } from "node:crypto";

const socketPath = process.argv[2] ?? "";

const waiting = new Map<string, (msg: any) => void>();
const conn = connect(socketPath);

interface AllowPermissionResult {
  behavior: "allow";
  updatedInput: object;
  updatedPermissions?: object[];
}
const dead = () => {
  for (const resolve of waiting.values()) {
    resolve({ behavior: "deny", message: "OpenMausBot: permission broker unavailable — skip this action" });
  }
  waiting.clear();
};
conn.on("error", dead);
conn.on("close", dead);

let connBuf = "";
conn.on("data", (chunk) => {
  connBuf += chunk;
  let nl;
  while ((nl = connBuf.indexOf("\n")) !== -1) {
    const line = connBuf.slice(0, nl);
    connBuf = connBuf.slice(nl + 1);
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.t === "answer") {
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  }
});

const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");

// The CLI's built-in AskUserQuestion reaches this proxy through the SAME
// `approve` call as a permission ask (tool_name="AskUserQuestion"), but it
// is a question, not an action: no grant — auto mode or "always allow" —
// may answer for the person. So it travels to the broker as question-kind,
// which the server only ever shows as a card, and on resolution we hand
// the CLI back the permission JSON contract it expects, with the human's
// selections injected as updatedInput.answers (the documented headless
// answer shape: each question's text → chosen label or free text).
const ASK_USER_QUESTION_TOOL = "AskUserQuestion";
const QUESTION_TIMEOUT_NOTE = "OpenMausBot: nobody answered in time. Use your best judgment and continue.";

interface ApprovalArgs {
  tool_name?: unknown;
  input?: unknown;
}

function isAskUserQuestion(args: ApprovalArgs): boolean {
  return args.tool_name === ASK_USER_QUESTION_TOOL;
}

/** The question list of an AskUserQuestion payload, read defensively —
 * the CLI hands this proxy arbitrary JSON, and a malformed entry must
 * degrade to being skipped rather than crashing the proxy mid-ask. */
// SAFETY: the casts below only re-view external JSON that every field read
// re-checks; nothing here trusts a shape it has not verified.
function wireQuestions(input: unknown): Array<Record<string, unknown>> {
  const questions = (input as { questions?: unknown } | undefined)?.questions;
  return Array.isArray(questions) ? (questions as Array<Record<string, unknown>>) : [];
}

/** The card text for an AskUserQuestion approve call: every question's
 * text joined, mirroring how the codex driver summarizes its questions. */
export function questionSummary(args: ApprovalArgs): string {
  const texts = wireQuestions(args.input)
    .map((q) => (typeof q.question === "string" ? q.question : typeof q.header === "string" ? q.header : ""))
    .filter(Boolean);
  return texts.length ? texts.join(" · ").slice(0, 300) : ASK_USER_QUESTION_TOOL;
}

/** One-tap choices: the labels of the FIRST question, which is also what
 * the codex driver offers; later questions stay answerable as free text. */
export function questionChoices(args: ApprovalArgs): string[] | undefined {
  const [first] = wireQuestions(args.input);
  if (!first || !Array.isArray(first.options)) return undefined;
  // SAFETY: options entries are external JSON; only string labels survive.
  const labels = first.options.filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null);
  const names = labels.map((o) => (typeof o.label === "string" ? o.label : "")).filter(Boolean);
  return names.length ? names.slice(0, 5) : undefined;
}

/** The transport ask an AskUserQuestion approve call becomes. */
export function askUserQuestionAsk(args: ApprovalArgs) {
  return {
    kind: "question" as const,
    tool: ASK_USER_QUESTION_TOOL,
    input: { question: questionSummary(args), choices: questionChoices(args) },
  };
}

/** The MCP tool result text for a resolved AskUserQuestion approve call.
 * An answered question allows the tool WITH the answers; anything else —
 * a timeout note, a system wrap-up, a deny — denies with that message so
 * the model reads why instead of mistaking silence for consent. */
export function askUserQuestionReply(args: ApprovalArgs, answer: { behavior: string; message?: string }): string {
  if (answer.behavior !== "answer") {
    return JSON.stringify({ behavior: "deny", message: answer.message || "Denied from OpenMausBot" });
  }
  // SAFETY: wireQuestions shape-checks each element of the CLI's JSON; only
  // entries carrying a string `question` can key the answers map.
  const answered = wireQuestions(args.input).filter((q): q is { question: string } => typeof q.question === "string");
  // the timeout note is guidance, not a selection — deny with it so the
  // model knows nobody chose, rather than reading it as an answer
  if (answer.message === QUESTION_TIMEOUT_NOTE || !answered.length) {
    return JSON.stringify({
      behavior: "deny",
      message: answer.message || "OpenMausBot: nobody answered the questions.",
    });
  }
  const answers = Object.fromEntries(
    answered.map((q) => [q.question, answer.message ?? ""] as const),
  );
  return JSON.stringify({
    behavior: "allow",
    // SAFETY: the CLI's own approve input echoed back with only `answers`
    // added — the shape the headless AskUserQuestion contract documents.
    updatedInput: { ...(args.input as object), answers },
  });
}

const TOOLS = [
  {
    name: "approve",
    description: "Ask the OpenMausBot user whether a tool use is allowed",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the human who owns this bot a question and wait for their answer. Use whenever you need a decision, a preference, missing information, or sign-off before doing something consequential — do not guess on things the owner would want to decide. Returns their answer as text.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, with enough context to answer at a glance" },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional 2-5 suggested answers, shown as one-tap buttons",
        },
      },
      required: ["question"],
    },
  },
];

async function handle(msg: any) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-permissions", version: "1" },
      },
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const askId = randomUUID();
    const isQuestion = name === "ask_user";
    // an AskUserQuestion arrives through `approve` but must travel and
    // resolve as a QUESTION — no grant may ever answer it
    const askQuestion = !isQuestion && name === "approve" && isAskUserQuestion(args);
    // the CLI may include its own suggested permission rules; on allow we
    // hand them straight back as updatedPermissions so claude stops asking
    // at its own layer — no invented rule syntax (agentcal)
    const suggestions = Array.isArray(args.permission_suggestions)
      ? args.permission_suggestions
      : Array.isArray(args.suggestions)
        ? args.suggestions
        : null;
    const answer: any = await new Promise((resolve) => {
      waiting.set(askId, resolve);
      if (conn.destroyed) return dead();
      const ask = isQuestion
        ? { t: "ask", id: askId, kind: "question", tool: "ask_user", input: { question: args.question, choices: args.choices } }
        : askQuestion
          ? { t: "ask", id: askId, ...askUserQuestionAsk(args) }
          : { t: "ask", id: askId, tool: args.tool_name, input: args.input };
      try {
        conn.write(JSON.stringify(ask) + "\n");
      } catch {
        dead();
      }
    });
    let text;
    if (isQuestion) {
      text = answer.message || "No answer was given — use your best judgment.";
    } else if (askQuestion) {
      text = askUserQuestionReply(args, answer);
    } else if (answer.behavior === "allow") {
      const result: AllowPermissionResult = { behavior: "allow", updatedInput: args.input ?? {} };
      if (answer.always && suggestions) result.updatedPermissions = suggestions;
      text = JSON.stringify(result);
    } else {
      text = JSON.stringify({ behavior: "deny", message: answer.message || "Denied from OpenMausBot" });
    }
    return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}

let inBuf = "";
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) !== -1) {
    const line = inBuf.slice(0, nl);
    inBuf = inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
