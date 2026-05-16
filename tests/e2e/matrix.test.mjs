import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CODEX_STUB = path.resolve(here, "..", "mocks", "stub-codex.mjs");
const CLAUDE_STUB = path.resolve(here, "..", "mocks", "stub-claude.mjs");
const OPENCODE_STUB = path.resolve(here, "..", "mocks", "stub-opencode.mjs");
const GROK_STUB = path.resolve(here, "..", "mocks", "stub-grok.mjs");

const ALL_AVAILABLE = {
  hosts: {
    "claude-code": { available: true, version: "test" },
    codex: { available: true, version: "test" },
    grok: { available: true, version: "test" },
    opencode: { available: true, version: "test" }
  }
};

vi.mock("../../core/src/targets/claude.mjs", async (importActual) => {
  const real = await importActual();
  return {
    ...real,
    buildInvocation: ({ mode, prompt }) => {
      if (mode !== "subprocess") throw new Error("unsupported mode");
      return { command: process.execPath, args: [CLAUDE_STUB], stdin: prompt };
    }
  };
});

vi.mock("../../core/src/targets/codex.mjs", async (importActual) => {
  const real = await importActual();
  return {
    ...real,
    buildInvocation: ({ mode, prompt }) => {
      if (mode !== "subprocess") throw new Error("unsupported mode");
      return { command: process.execPath, args: [CODEX_STUB], stdin: prompt };
    }
  };
});

vi.mock("../../core/src/targets/opencode.mjs", async (importActual) => {
  const real = await importActual();
  return {
    ...real,
    buildInvocation: ({ mode, prompt }) => {
      if (mode !== "subprocess") throw new Error("unsupported mode");
      return { command: process.execPath, args: [OPENCODE_STUB], stdin: prompt };
    }
  };
});

vi.mock("../../core/src/targets/grok.mjs", async (importActual) => {
  const real = await importActual();
  return {
    ...real,
    buildInvocation: ({ mode, prompt }) => {
      if (mode !== "subprocess") throw new Error("unsupported mode");
      return { command: process.execPath, args: [GROK_STUB], stdin: prompt };
    }
  };
});

let tmpLogDir;
let saved = {};

beforeEach(() => {
  tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-matrix-"));
  saved.CHORUS_REPO_ROOT = process.env.CHORUS_REPO_ROOT;
  saved.CHORUS_FORCE_MODE = process.env.CHORUS_FORCE_MODE;
  process.env.CHORUS_REPO_ROOT = tmpLogDir;
  process.env.CHORUS_FORCE_MODE = "subprocess";
  process.env.CHORUS_STUB_MODE = "ok";
});

afterEach(() => {
  if (saved.CHORUS_REPO_ROOT === undefined) delete process.env.CHORUS_REPO_ROOT;
  else process.env.CHORUS_REPO_ROOT = saved.CHORUS_REPO_ROOT;
  if (saved.CHORUS_FORCE_MODE === undefined) delete process.env.CHORUS_FORCE_MODE;
  else process.env.CHORUS_FORCE_MODE = saved.CHORUS_FORCE_MODE;
  delete process.env.CHORUS_STUB_MODE;
  try { fs.rmSync(tmpLogDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const HOSTS = ["claude-code", "codex", "grok", "opencode"];
const WIRED = new Set(["claude-code", "codex", "opencode", "grok"]);

// 16 source × target scenarios. M1 wires 4 of them (the 2x2 of {claude-code, codex}).
// The remaining 12 are .todo until their target drivers land in M2/M3.
const scenarios = [];
for (const source of HOSTS) {
  for (const target of HOSTS) {
    scenarios.push({ source, target });
  }
}

describe("4×4 cross-CLI smoke matrix (stubbed)", () => {
  for (const { source, target } of scenarios) {
    const live = WIRED.has(target);
    const allowSelf = source === target;
    const fn = live ? it : it.todo;
    const label = `${source.padEnd(11)} → ${target.padEnd(11)} (reviewer)`;

    fn(label, async () => {
      const { callOne } = await import("../../core/src/invoke.mjs");
      const r = await callOne({
        source,
        target,
        role: "reviewer",
        task: "smoke",
        registry: ALL_AVAILABLE,
        timeoutS: 5,
        allowSelf
      });
      expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
      expect(r.source).toBe(source);
      expect(r.target).toBe(target);
      expect(r.schema_id).toBe("reviewer");
      expect(r.trace_depth).toBe(1);
      expect(r).not.toHaveProperty("log_path");
      expect(r).not.toHaveProperty("schema");
    });
  }
});
