import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  jsonrpcRequest,
  jsonrpcNotification,
  isResponse,
  isNotification,
  isRequest,
  buildInitializeRequest,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  buildSessionCancelNotification
} from "../../../src/acp/messages.mjs";

describe("acp.messages", () => {
  it("jsonrpcRequest shape", () => {
    const r = jsonrpcRequest(7, "test/method", { x: 1 });
    expect(r).toEqual({ jsonrpc: "2.0", id: 7, method: "test/method", params: { x: 1 } });
  });

  it("jsonrpcNotification has no id", () => {
    const n = jsonrpcNotification("notify", { v: 1 });
    expect(n).toEqual({ jsonrpc: "2.0", method: "notify", params: { v: 1 } });
    expect(n.id).toBeUndefined();
  });

  it("isResponse / isNotification / isRequest discriminate correctly", () => {
    const resp = { jsonrpc: "2.0", id: 1, result: { ok: true } };
    const err = { jsonrpc: "2.0", id: 2, error: { code: -1, message: "x" } };
    const notif = { jsonrpc: "2.0", method: "session/update", params: {} };
    const req = { jsonrpc: "2.0", id: 3, method: "initialize", params: {} };

    expect(isResponse(resp)).toBe(true);
    expect(isResponse(err)).toBe(true);
    expect(isResponse(notif)).toBe(false);
    expect(isResponse(req)).toBe(false);

    expect(isNotification(notif)).toBe(true);
    expect(isNotification(req)).toBe(false);

    expect(isRequest(req)).toBe(true);
    expect(isRequest(notif)).toBe(false);
    expect(isRequest(resp)).toBe(false);
  });

  it("buildInitializeRequest sends protocol version + capabilities", () => {
    const r = buildInitializeRequest(0, { name: "chorus", version: "0.1.0" });
    expect(r.method).toBe("initialize");
    expect(r.params.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(r.params.clientCapabilities.fs.readTextFile).toBe(false);
    expect(r.params.clientCapabilities.terminal).toBe(false);
    expect(r.params.clientInfo.name).toBe("chorus");
  });

  it("buildSessionNewRequest defaults mcpServers to empty + cwd", () => {
    const r = buildSessionNewRequest(1, { cwd: "/tmp/test" });
    expect(r.method).toBe("session/new");
    expect(r.params.cwd).toBe("/tmp/test");
    expect(r.params.mcpServers).toEqual([]);
  });

  it("buildSessionPromptRequest wraps text in a ContentBlock array", () => {
    const r = buildSessionPromptRequest(2, "sess_abc", "hello");
    expect(r.method).toBe("session/prompt");
    expect(r.params.sessionId).toBe("sess_abc");
    expect(r.params.prompt).toEqual([{ type: "text", text: "hello" }]);
  });

  it("buildSessionCancelNotification has no id", () => {
    const n = buildSessionCancelNotification("sess_abc");
    expect(n.method).toBe("session/cancel");
    expect(n.params.sessionId).toBe("sess_abc");
    expect(n.id).toBeUndefined();
  });
});
