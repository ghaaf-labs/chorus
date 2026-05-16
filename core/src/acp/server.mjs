import readline from "node:readline";
import { callOne } from "../invoke.mjs";
import { ROLE_NAMES, pickDefaultRole } from "../roles/defaults.mjs";
import { PROTOCOL_VERSION } from "./messages.mjs";

const SERVER_INFO = { name: "chorus", title: "Chorus (multi-CLI agent collaboration)", version: "0.1.0" };

const AGENT_CAPABILITIES = {
  loadSession: false,
  promptCapabilities: {
    image: false,
    audio: false,
    embeddedContext: true
  },
  mcpCapabilities: {
    http: false,
    sse: false
  }
};

const DIRECTIVE_RE = /^@(claude-code|codex|grok|opencode|reviewer|researcher|architect|devils-advocate)\b/;
const TARGETS = new Set(["claude-code", "codex", "grok", "opencode"]);

function parsePrompt(textParts) {
  const text = textParts
    .map((p) => (p?.type === "text" ? p.text : (p?.text || "")))
    .join("\n")
    .trim();
  let remaining = text;
  let target;
  let role;
  while (true) {
    const m = remaining.match(DIRECTIVE_RE);
    if (!m) break;
    const tok = m[1];
    if (TARGETS.has(tok)) target = tok;
    else if (ROLE_NAMES.includes(tok)) role = tok;
    remaining = remaining.slice(m[0].length).trimStart();
  }
  if (!role) role = pickDefaultRole(remaining);
  return { task: remaining, target, role };
}

export async function runAcpServer({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const sessions = new Map();
  let nextSessionNum = 1;

  function send(obj) {
    stdout.write(JSON.stringify(obj) + "\n");
  }

  function notify(method, params) {
    send({ jsonrpc: "2.0", method, params });
  }

  function reply(id, result) {
    send({ jsonrpc: "2.0", id, result });
  }

  function replyError(id, code, message, data) {
    send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
  }

  async function handleInitialize(id, _params) {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: AGENT_CAPABILITIES,
      agentInfo: SERVER_INFO,
      authMethods: []
    });
  }

  async function handleSessionNew(id, params) {
    const sessionId = `chorus-${Date.now().toString(36)}-${nextSessionNum++}`;
    sessions.set(sessionId, { cwd: params?.cwd, createdAt: Date.now() });
    reply(id, { sessionId });
  }

  async function handleSessionPrompt(id, params) {
    const { sessionId, prompt } = params || {};
    if (!sessions.has(sessionId)) {
      replyError(id, -32602, `unknown sessionId: ${sessionId}`);
      return;
    }
    const parsed = parsePrompt(prompt || []);
    if (!parsed.task) {
      replyError(id, -32602, "empty prompt");
      return;
    }

    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: `chorus: routing role=${parsed.role}${parsed.target ? ` target=${parsed.target}` : " (auto)"}\n` }
      }
    });

    const result = await callOne({
      source: "acp-client",
      target: parsed.target,
      role: parsed.role,
      task: parsed.task
    });

    const summary = result.ok
      ? JSON.stringify(result.result, null, 2)
      : `chorus error: ${result.error}${result.hint ? `\nhint: ${result.hint}` : ""}`;

    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: summary }
      }
    });

    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: {
          type: "text",
          text: `\n[${result.target ?? "no target"} ${parsed.role} | ${result.duration_ms ?? "?"}ms | tokens=${result.tokens?.total ?? 0} | cost=$${(result.cost_usd_estimate ?? 0).toFixed(4)}]\n`
        }
      }
    });

    reply(id, { stopReason: result.ok ? "end_turn" : "refusal" });
  }

  async function handleSessionCancel(_params) {
    // No-op for now: Chorus's callOne does not yet expose cancel.
  }

  async function dispatch(msg) {
    if (msg.id !== undefined && msg.method) {
      // request
      try {
        switch (msg.method) {
          case "initialize":
            return handleInitialize(msg.id, msg.params);
          case "session/new":
            return handleSessionNew(msg.id, msg.params);
          case "session/prompt":
            return handleSessionPrompt(msg.id, msg.params);
          case "authenticate":
            return reply(msg.id, {});
          default:
            return replyError(msg.id, -32601, `method not found: ${msg.method}`);
        }
      } catch (err) {
        return replyError(msg.id, -32603, err?.message || "internal error", { stack: err?.stack?.slice(0, 1024) });
      }
    } else if (msg.method) {
      // notification
      if (msg.method === "session/cancel") {
        return handleSessionCancel(msg.params);
      }
    }
  }

  const rl = readline.createInterface({ input: stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      stderr.write(`chorus-acp: unparseable line: ${line.slice(0, 200)}\n`);
      return;
    }
    await dispatch(msg);
  });

  await new Promise((resolve) => rl.once("close", resolve));
}
