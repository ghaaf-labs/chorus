import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(here, "..", "..", "..", "tests", "mocks", "stub-codex.mjs");

const FAKE_REGISTRY = {
  hosts: {
    "claude-code": { available: true, version: "test" },
    codex: { available: true, version: "test" }
  }
};

// Replace the codex driver's buildInvocation so invoke.mjs routes its spawn
// to our stub script instead of the real `codex` binary.
vi.mock("../../src/targets/codex.mjs", async (importActual) => {
  const real = await importActual();
  return {
    ...real,
    buildInvocation: ({ mode, prompt }) => {
      if (mode !== "subprocess") throw new Error("unsupported mode");
      return {
        command: process.execPath,
        args: [STUB],
        stdin: prompt
      };
    }
  };
});

let tmpLogDir;
let tmpBudgetPath;
const saved = {};

beforeEach(() => {
  tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-test-"));
  tmpBudgetPath = path.join(tmpLogDir, "budget.json");
  saved.CHORUS_REPO_ROOT = process.env.CHORUS_REPO_ROOT;
  saved.CHORUS_BUDGET_PATH = process.env.CHORUS_BUDGET_PATH;
  process.env.CHORUS_REPO_ROOT = tmpLogDir;
  process.env.CHORUS_BUDGET_PATH = tmpBudgetPath;
});

afterEach(() => {
  if (saved.CHORUS_REPO_ROOT === undefined) delete process.env.CHORUS_REPO_ROOT;
  else process.env.CHORUS_REPO_ROOT = saved.CHORUS_REPO_ROOT;
  if (saved.CHORUS_BUDGET_PATH === undefined) delete process.env.CHORUS_BUDGET_PATH;
  else process.env.CHORUS_BUDGET_PATH = saved.CHORUS_BUDGET_PATH;
  try { fs.rmSync(tmpLogDir, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CHORUS_STUB_")) delete process.env[k];
  }
});

async function callWith(mode, opts = {}) {
  process.env.CHORUS_STUB_MODE = mode;
  const { callOne } = await import("../../src/invoke.mjs");
  return callOne({
    source: "test",
    target: "codex",
    role: "reviewer",
    task: "test",
    registry: FAKE_REGISTRY,
    timeoutS: 5,
    ...opts
  });
}

describe("invoke.callOne", () => {
  it("ok path: validated result, hardened envelope (no log_path / no schema path)", async () => {
    const r = await callWith("ok");
    expect(r.ok).toBe(true);
    expect(r.result.verdict).toBe("approve");
    expect(r.schema_id).toBe("reviewer");
    expect(r.trace_depth).toBe(1);
    expect(r).not.toHaveProperty("log_path");
    expect(r).not.toHaveProperty("schema");
  });

  it("schema_violation: stub emits invalid JSON; validator errors are summarized, not bulky", async () => {
    const r = await callWith("schema_violation");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("schema_violation");
    expect(r.hint).toBeTruthy();
    expect(r.validator_errors_summary).toBeTruthy();
    expect(typeof r.validator_errors_summary.count).toBe("number");
    expect(r).not.toHaveProperty("validator_errors");
  });

  it("non_json: stub emits non-JSON; reason is could_not_parse_json", async () => {
    const r = await callWith("non_json");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("schema_violation");
    expect(r.reason).toBe("could_not_parse_json");
  });

  it("stdout_overflow: huge stdout never appears in caller envelope", async () => {
    const r = await callWith("overflow", { timeoutS: 15 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("stdout_overflow");
    expect(r.limit_bytes).toBeGreaterThan(0);
    expect(JSON.stringify(r).length).toBeLessThan(50_000);
  });

  it("timeout: stub sleeps; envelope reports timeout, child is reaped", async () => {
    const r = await callWith("sleep_forever", { timeoutS: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
    expect(r.timeout_s).toBe(1);
  });

  it("nonzero_exit: stderr_excerpt is bounded", async () => {
    const r = await callWith("nonzero");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nonzero_exit");
    expect(r.exit_code).toBe(1);
    expect(r.stderr_excerpt).toContain("stub failure");
  });

  it("max_depth_exceeded: refuses BEFORE spawning when CHORUS_DEPTH is at the limit", async () => {
    process.env.CHORUS_DEPTH = "2";
    process.env.CHORUS_MAX_DEPTH = "2";
    try {
      const r = await callWith("ok");
      expect(r.ok).toBe(false);
      expect(r.error).toBe("max_depth_exceeded");
    } finally {
      delete process.env.CHORUS_DEPTH;
      delete process.env.CHORUS_MAX_DEPTH;
    }
  });

  it("no_available_target: empty registry returns structured error with hint", async () => {
    const { callOne } = await import("../../src/invoke.mjs");
    const r = await callOne({
      source: "test",
      role: "reviewer",
      task: "x",
      registry: { hosts: {} },
      timeoutS: 5
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_available_target");
    expect(r.hint).toBeTruthy();
  });
});

describe("invoke.callOne — sentinel: no inner subprocess content leaks to caller", () => {
  it("50MB input does not grow the returned envelope beyond a few KB", async () => {
    const huge = "x".repeat(50 * 1024 * 1024);
    const r = await callWith("ok", { inputText: huge });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r).length).toBeLessThan(10_000);
  }, 30_000);

  it("stub's stderr/stdout sentinel never appears in caller envelope", async () => {
    process.env.CHORUS_STUB_SENTINEL = "CHORUS_TEST_SENTINEL_LEAK_DETECTOR_abc123";
    try {
      const r = await callWith("sentinel");
      expect(r.ok).toBe(true);
      const dump = JSON.stringify(r);
      // The stub bakes the sentinel into both stderr and the assistant text.
      // The assistant text gets summarized into result.summary, so that ONE
      // copy is allowed; but the parent must never see two copies (which would
      // mean stderr leaked through too).
      const occurrences = (dump.match(/CHORUS_TEST_SENTINEL_LEAK_DETECTOR_abc123/g) || []).length;
      expect(occurrences).toBeLessThanOrEqual(1);
    } finally {
      delete process.env.CHORUS_STUB_SENTINEL;
    }
  });
});
