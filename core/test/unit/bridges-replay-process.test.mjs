import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bridgeAvailable, resetBridgeCache } from "../../src/targets/bridges.mjs";
import * as opencode from "../../src/targets/opencode.mjs";
import { ACP } from "../../src/targets/driver.mjs";
import { appendJobIndex, maybeRotateJobIndex, jobsIndexPath } from "../../src/logging.mjs";
import { findJobById, loadJobPayload } from "../../src/replay.mjs";
import { pickDefaultRole } from "../../src/roles/defaults.mjs";
import { runSubprocess } from "../../src/runners/process.mjs";

let saved;
let tmpHome;

beforeEach(() => {
  saved = {
    HOME: process.env.HOME,
    CHORUS_DISABLE_BRIDGES: process.env.CHORUS_DISABLE_BRIDGES,
    CHORUS_JOBS_ROTATE_BYTES: process.env.CHORUS_JOBS_ROTATE_BYTES,
    CHORUS_JOBS_ROTATE_KEEP: process.env.CHORUS_JOBS_ROTATE_KEEP
  };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-bridge-replay-"));
  process.env.HOME = tmpHome;
  resetBridgeCache();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  resetBridgeCache();
});

describe("bridges.bridgeAvailable", () => {
  it("returns true for a binary that exists (uses node itself)", () => {
    // node executable always exists in the test environment; probe it via the
    // platform-neutral name "node" — if a CI image lacks it this whole test
    // suite couldn't run, so the assumption is safe.
    expect(bridgeAvailable("node")).toBe(true);
  });

  it("returns false for a binary that doesn't exist", () => {
    expect(bridgeAvailable("definitely-not-a-real-binary-xyz")).toBe(false);
  });

  it("returns false when CHORUS_DISABLE_BRIDGES=1 even if the bin exists", () => {
    process.env.CHORUS_DISABLE_BRIDGES = "1";
    resetBridgeCache();
    expect(bridgeAvailable("node")).toBe(false);
  });
});

describe("opencode ACP buildInvocation", () => {
  it("passes OPENCODE_MODEL when model given", () => {
    const s = opencode.buildInvocation({ mode: ACP, prompt: "hi", model: "anthropic/claude-haiku-4-5" });
    expect(s.command).toBe("opencode");
    expect(s.args).toEqual(["acp", "--pure"]);
    expect(s.env).toEqual({ OPENCODE_MODEL: "anthropic/claude-haiku-4-5" });
  });

  it("omits env when model not given", () => {
    const s = opencode.buildInvocation({ mode: ACP, prompt: "hi" });
    expect(s.env).toEqual({});
  });
});

describe("logging.maybeRotateJobIndex", () => {
  it("does nothing if file is small", async () => {
    await appendJobIndex({ job_id: "t1", source: "x", target: "y", role: "z", ok: true });
    const r = await maybeRotateJobIndex({ sizeLimit: 10_000_000 });
    expect(r.rotated).toBe(false);
  });

  it("rotates when threshold exceeded and creates .1", async () => {
    const p = jobsIndexPath();
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, "x".repeat(200));
    const r = await maybeRotateJobIndex({ sizeLimit: 100, keep: 3 });
    expect(r.rotated).toBe(true);
    expect(fs.existsSync(`${p}.1`)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("cascades existing rotations: .1 → .2 → .3, drops anything past keep", async () => {
    const p = jobsIndexPath();
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(`${p}.1`, "one");
    await fsp.writeFile(`${p}.2`, "two");
    await fsp.writeFile(p, "x".repeat(200));
    await maybeRotateJobIndex({ sizeLimit: 100, keep: 3 });
    expect(fs.readFileSync(`${p}.1`, "utf8")).toMatch(/^x+$/);
    expect(fs.readFileSync(`${p}.2`, "utf8")).toBe("one");
    expect(fs.readFileSync(`${p}.3`, "utf8")).toBe("two");
  });
});

describe("replay.findJobById", () => {
  it("returns null when no jobs.jsonl exists", () => {
    expect(findJobById("xyz")).toBeNull();
  });

  it("finds an entry by job_id", async () => {
    await appendJobIndex({ job_id: "abc", source: "cli", target: "codex", role: "reviewer", ok: true });
    await appendJobIndex({ job_id: "def", source: "cli", target: "grok", role: "researcher", ok: true });
    const found = findJobById("def");
    expect(found?.target).toBe("grok");
  });

  it("searches rotated files too", async () => {
    const p = jobsIndexPath();
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(`${p}.1`, JSON.stringify({ job_id: "rotated-1", target: "codex" }) + "\n");
    const found = findJobById("rotated-1");
    expect(found?.target).toBe("codex");
  });
});

describe("replay.loadJobPayload", () => {
  it("returns null when sidecar missing", () => {
    expect(loadJobPayload(path.join(tmpHome, "nope.jsonl"))).toBeNull();
  });

  it("parses sidecar payload", () => {
    const logPath = path.join(tmpHome, "x.jsonl");
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(logPath.replace(/\.jsonl$/, ".payload.json"), JSON.stringify({ task: "t", input_text: "i" }));
    const p = loadJobPayload(logPath);
    expect(p.task).toBe("t");
    expect(p.input_text).toBe("i");
  });
});

describe("auto-role default via pickDefaultRole", () => {
  it("routes a review-shaped task to reviewer", () => {
    expect(pickDefaultRole("please review this diff")).toBe("reviewer");
  });

  it("falls through to researcher on neutral text", () => {
    expect(pickDefaultRole("what is 2 + 2")).toBe("researcher");
  });
});

describe("runSubprocess abortSignal", () => {
  it("aborts an in-flight process and returns error:aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const spec = { command: process.execPath, args: ["-e", "setTimeout(()=>{},10000)"], stdin: "" };
    const r = await runSubprocess({ spec, timeoutS: 10, abortSignal: controller.signal });
    expect(r.error).toBe("aborted");
  });

  it("never starts a kill if abortSignal not used", async () => {
    const spec = { command: process.execPath, args: ["-e", "console.log('ok')"], stdin: "" };
    const r = await runSubprocess({ spec, timeoutS: 5 });
    expect(r.error).toBeUndefined();
    expect(r.stdout.trim()).toBe("ok");
  });
});
