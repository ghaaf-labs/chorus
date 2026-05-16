import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["CHORUS_DEPTH", "CHORUS_TRACE", "CHORUS_MAX_DEPTH"];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function fresh() {
  return await import("../../src/recursion-guard.mjs");
}

describe("recursion-guard", () => {
  it("returns depth 0 with no env", async () => {
    delete process.env.CHORUS_DEPTH;
    const m = await fresh();
    expect(m.currentDepth()).toBe(0);
  });

  it("reads depth from env", async () => {
    process.env.CHORUS_DEPTH = "1";
    const m = await fresh();
    expect(m.currentDepth()).toBe(1);
  });

  it("blocks when depth is at MAX_DEPTH", async () => {
    process.env.CHORUS_DEPTH = "2";
    const m = await fresh();
    const r = m.checkGuards({ source: "a", target: "b", role: "reviewer" });
    expect(r.blocked).toBe(true);
    expect(r.error).toBe("max_depth_exceeded");
  });

  it("blocks cycles by edge", async () => {
    process.env.CHORUS_DEPTH = "1";
    process.env.CHORUS_TRACE = JSON.stringify([{ source: "a", target: "b", role: "reviewer" }]);
    const m = await fresh();
    const r = m.checkGuards({ source: "a", target: "b", role: "reviewer" });
    expect(r.blocked).toBe(true);
    expect(r.error).toBe("cycle");
  });

  it("allows non-cycle edges below max depth", async () => {
    process.env.CHORUS_DEPTH = "1";
    process.env.CHORUS_TRACE = JSON.stringify([{ source: "a", target: "b", role: "reviewer" }]);
    const m = await fresh();
    const r = m.checkGuards({ source: "b", target: "c", role: "researcher" });
    expect(r.blocked).toBe(false);
  });

  it("childEnv increments depth and appends trace", async () => {
    process.env.CHORUS_DEPTH = "0";
    process.env.CHORUS_TRACE = "[]";
    const m = await fresh();
    const env = m.childEnv({ source: "claude-code", target: "codex", role: "reviewer" });
    expect(env.CHORUS_DEPTH).toBe("1");
    const trace = JSON.parse(env.CHORUS_TRACE);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toEqual({ source: "claude-code", target: "codex", role: "reviewer" });
  });
});
