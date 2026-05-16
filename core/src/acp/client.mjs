import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import {
  buildInitializeRequest,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  buildSessionCancelNotification,
  isResponse,
  isNotification,
  isRequest,
  jsonrpcRequest
} from "./messages.mjs";

const CLIENT_INFO = { name: "chorus", title: "Chorus", version: "0.1.0" };

/**
 * Long-lived ACP client. Spawns an ACP agent process, frames JSON-RPC 2.0
 * messages on stdio (newline-delimited), routes responses to pending
 * requests, and emits notifications via the EventEmitter interface.
 *
 * Lifecycle:
 *   const c = new AcpClient({ command: "grok", args: ["agent", "stdio"] });
 *   await c.start();
 *   await c.initialize();
 *   const sessionId = await c.newSession();
 *   const result = await c.prompt(sessionId, "hi");
 *   await c.close();
 */
export class AcpClient extends EventEmitter {
  constructor({ command, args = [], env = {}, cwd, logger }) {
    super();
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.logger = logger;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.serverInfo = null;
    this.serverCapabilities = null;
    this._closed = false;
  }

  async start() {
    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this._handleLine(line));
    this.proc.stderr.on("data", (chunk) => {
      this.logger?.event("acp_stderr", { bytes: chunk.length, head: chunk.toString("utf8").slice(0, 200) });
    });
    this.proc.on("close", (code, signal) => {
      this._closed = true;
      this.logger?.event("acp_close", { code, signal });
      for (const { reject } of this.pending.values()) {
        reject(new Error(`ACP agent exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.emit("close", { code, signal });
    });
    this.proc.on("error", (err) => {
      this.logger?.event("acp_error", { error: err.message });
      this.emit("error", err);
    });
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger?.event("acp_unparseable_line", { head: line.slice(0, 200) });
      return;
    }
    if (isResponse(msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        this.logger?.event("acp_orphan_response", { id: msg.id });
        return;
      }
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else pending.resolve(msg.result);
    } else if (isNotification(msg)) {
      this.emit("notification", msg);
      this.emit(`notification:${msg.method}`, msg.params);
    } else if (isRequest(msg)) {
      this._handleServerRequest(msg);
    }
  }

  _handleServerRequest(msg) {
    // Many ACP agents send fs/* and terminal/* requests to the client.
    // We declared clientCapabilities.fs = false / terminal = false, so we
    // refuse with a structured error per JSON-RPC. Servers that ignore our
    // capability declaration and still call these will get a clean reject.
    const error = { code: -32601, message: `Method not supported by Chorus client: ${msg.method}` };
    this._send({ jsonrpc: "2.0", id: msg.id, error });
  }

  _send(obj) {
    if (this._closed) throw new Error("ACP agent closed");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  _request(method, params) {
    const id = this.nextId++;
    const req = jsonrpcRequest(id, method, params);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this._send(req);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async initialize(clientCapabilities = {}) {
    const id = this.nextId++;
    const req = buildInitializeRequest(id, CLIENT_INFO, clientCapabilities);
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => {
          this.initialized = true;
          this.serverInfo = result.agentInfo ?? null;
          this.serverCapabilities = result.agentCapabilities ?? null;
          resolve(result);
        },
        reject
      });
      this._send(req);
    });
  }

  async newSession(params = {}) {
    const id = this.nextId++;
    const req = buildSessionNewRequest(id, { cwd: this.cwd, ...params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result.sessionId),
        reject
      });
      this._send(req);
    });
  }

  /**
   * Send a prompt and collect streaming updates until the final result.
   *
   * Returns { stopReason, assistantText, thoughts, durationMs }.
   * The `onUpdate` callback receives every session/update notification for
   * the matching sessionId.
   */
  async prompt(sessionId, text, { onUpdate, timeoutMs } = {}) {
    let assistantText = "";
    let thoughts = "";
    let toolCalls = [];

    const updateListener = (params) => {
      if (params?.sessionId !== sessionId) return;
      const u = params.update || {};
      const kind = u.sessionUpdate;
      if (kind === "agent_message_chunk" && u.content?.type === "text") {
        assistantText += u.content.text;
      } else if (kind === "agent_thought_chunk" && u.content?.type === "text") {
        thoughts += u.content.text;
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        toolCalls.push(u);
      }
      onUpdate?.(u);
    };
    this.on("notification:session/update", updateListener);

    const start = Date.now();
    let timer;
    try {
      const promptId = this.nextId++;
      const promptReq = buildSessionPromptRequest(promptId, sessionId, text);
      const result = await new Promise((resolve, reject) => {
        this.pending.set(promptId, { resolve, reject });
        if (timeoutMs) {
          timer = setTimeout(() => {
            if (!this.pending.has(promptId)) return;
            try {
              this._send(buildSessionCancelNotification(sessionId));
            } catch { /* ignore */ }
            this.pending.delete(promptId);
            reject(new Error("acp_prompt_timeout"));
          }, timeoutMs);
        }
        this._send(promptReq);
      });
      return {
        stopReason: result.stopReason,
        assistantText,
        thoughts,
        toolCalls,
        durationMs: Date.now() - start
      };
    } finally {
      if (timer) clearTimeout(timer);
      this.off("notification:session/update", updateListener);
    }
  }

  async close() {
    if (this._closed) return;
    try {
      this.proc?.stdin?.end();
    } catch { /* ignore */ }
    try {
      this.proc?.kill("SIGTERM");
    } catch { /* ignore */ }
    await new Promise((resolve) => {
      if (this._closed) return resolve();
      this.proc?.on("close", () => resolve());
      setTimeout(resolve, 1000);
    });
  }
}
