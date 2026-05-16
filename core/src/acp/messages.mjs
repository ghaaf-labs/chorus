// ACP / JSON-RPC 2.0 message shape helpers.
// Spec: https://agentclientprotocol.com/

export const PROTOCOL_VERSION = 1;

export function jsonrpcRequest(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

export function jsonrpcNotification(method, params) {
  return { jsonrpc: "2.0", method, params };
}

export function isResponse(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return false;
  if (msg.id === undefined) return false;
  return msg.result !== undefined || msg.error !== undefined;
}

export function isNotification(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return false;
  return Boolean(msg.method) && msg.id === undefined;
}

export function isRequest(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return false;
  return Boolean(msg.method) && msg.id !== undefined;
}

export function buildInitializeRequest(id, clientInfo, clientCapabilities = {}) {
  return jsonrpcRequest(id, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      ...clientCapabilities
    },
    clientInfo
  });
}

export function buildSessionNewRequest(id, params = {}) {
  return jsonrpcRequest(id, "session/new", {
    mcpServers: [],
    cwd: params.cwd || process.cwd(),
    ...params
  });
}

export function buildSessionPromptRequest(id, sessionId, text, extras = []) {
  const prompt = [{ type: "text", text }, ...extras];
  return jsonrpcRequest(id, "session/prompt", { sessionId, prompt });
}

export function buildSessionCancelNotification(sessionId) {
  return jsonrpcNotification("session/cancel", { sessionId });
}
