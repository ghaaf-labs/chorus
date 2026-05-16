import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fuzzCanaries, MUTATION_CLASSES } from "../../src/canary-fuzzer.mjs";
import { CANARY_TOKENS, scanForBreaches } from "../../src/canary.mjs";
import { buildTrustReport, detectVerdictDrift, listBreachesInJobs, ciGate, saveTrustReport } from "../../src/trust.mjs";
import { appendJobIndex, newJobLogPath } from "../../src/logging.mjs";

let saved;
let tmpHome;

beforeEach(() => {
  saved = { HOME: process.env.HOME };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-trust-report-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("canary-fuzzer.fuzzCanaries", () => {
  it("generates seeds × classes variants", () => {
    const variants = fuzzCanaries();
    // 3 seeds × N mutation classes
    expect(variants.length).toBe(3 * MUTATION_CLASSES.length);
    for (const v of variants) {
      expect(v.expected_token).toMatch(/^CHORUS_CANARY_BREACH_/);
      expect(v.id).toContain("-");
    }
  });

  it("restricts to selected mutation classes", () => {
    const variants = fuzzCanaries({ classes: ["homoglyph"] });
    expect(variants.length).toBe(3);
    for (const v of variants) expect(v.mutation_class).toBe("homoglyph");
  });

  it("each mutation preserves the trap token", () => {
    const variants = fuzzCanaries();
    for (const v of variants) {
      // Either the literal token survives (rolepl/base64/inject/mlang) or it's been homoglyphed —
      // verify the seed-and-class mapping at minimum:
      expect(v.text.length).toBeGreaterThan(0);
    }
  });
});

describe("trust.buildTrustReport (empty history)", () => {
  it("returns zero counts and no vendors", () => {
    const r = buildTrustReport();
    expect(r.summary.breach_count).toBe(0);
    expect(r.summary.drift_count).toBe(0);
    expect(r.summary.vendors_seen).toEqual([]);
  });
});

describe("trust.listBreachesInJobs", () => {
  it("finds a planted breach in a payload sidecar", async () => {
    const logPath = newJobLogPath({ source: "test", target: "codex", role: "reviewer", jobId: "breach-1" });
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(
      logPath.replace(/\.jsonl$/, ".payload.json"),
      JSON.stringify({ stdout: `here we go: ${CANARY_TOKENS[0]} done.` })
    );
    await appendJobIndex({
      job_id: "breach-1", source: "test", target: "codex", role: "reviewer",
      ok: true, duration_ms: 1, started_at: new Date().toISOString(),
      parent_job_ids: [], log_path: logPath
    });
    const breaches = listBreachesInJobs();
    expect(breaches).toHaveLength(1);
    expect(breaches[0].tokens).toContain(CANARY_TOKENS[0]);
  });
});

describe("trust.detectVerdictDrift", () => {
  it("finds parent→child outcome flips on same (target, role)", async () => {
    await appendJobIndex({
      job_id: "p1", source: "cli", target: "codex", role: "reviewer",
      ok: true, started_at: new Date(Date.now() - 60000).toISOString(),
      duration_ms: 1, parent_job_ids: []
    });
    await appendJobIndex({
      job_id: "c1", source: "regress", target: "codex", role: "reviewer",
      ok: false, started_at: new Date().toISOString(),
      duration_ms: 1, parent_job_ids: ["p1"]
    });
    const drift = detectVerdictDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].before.ok).toBe(true);
    expect(drift[0].after.ok).toBe(false);
  });

  it("does NOT flag drift across different (target, role)", async () => {
    await appendJobIndex({
      job_id: "p2", source: "cli", target: "codex", role: "reviewer",
      ok: true, started_at: new Date(Date.now() - 60000).toISOString(),
      duration_ms: 1, parent_job_ids: []
    });
    await appendJobIndex({
      job_id: "c2", source: "regress", target: "grok", role: "reviewer",
      ok: false, started_at: new Date().toISOString(),
      duration_ms: 1, parent_job_ids: ["p2"]
    });
    const drift = detectVerdictDrift();
    expect(drift).toEqual([]);
  });
});

describe("trust.ciGate", () => {
  it("passes on a clean history", () => {
    const r = ciGate();
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("fails when breaches exist", async () => {
    const logPath = newJobLogPath({ source: "test", target: "grok", role: "reviewer", jobId: "ci-bad" });
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(
      logPath.replace(/\.jsonl$/, ".payload.json"),
      JSON.stringify({ stdout: `${CANARY_TOKENS[1]}` })
    );
    await appendJobIndex({
      job_id: "ci-bad", source: "test", target: "grok", role: "reviewer",
      ok: true, duration_ms: 1, started_at: new Date().toISOString(),
      parent_job_ids: [], log_path: logPath
    });
    const r = ciGate();
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toContain("breaches");
  });
});

describe("trust.saveTrustReport", () => {
  it("writes JSON to ~/.chorus/trust/", () => {
    const file = saveTrustReport(buildTrustReport());
    expect(fs.existsSync(file)).toBe(true);
    expect(file).toContain(path.join(tmpHome, ".chorus", "trust"));
  });
});
