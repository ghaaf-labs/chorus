import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildPlaybook, savePlaybook, loadPlaybook, pickByPlaybook } from "../../src/playbook.mjs";
import { findNearDuplicate } from "../../src/dedup.mjs";
import { appendJobIndex, jobsIndexPath } from "../../src/logging.mjs";
import { ROLE_NAMES, defaultTargetOrder } from "../../src/roles/defaults.mjs";

let saved;
let tmpHome;

beforeEach(() => {
  saved = { HOME: process.env.HOME };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-playbook-dedup-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function seed(entries) {
  for (const e of entries) {
    await appendJobIndex({
      job_id: e.job_id ?? Math.random().toString(36).slice(2),
      source: e.source ?? "cli",
      target: e.target,
      role: e.role,
      ok: e.ok,
      duration_ms: 100,
      started_at: e.started_at ?? new Date().toISOString(),
      parent_job_ids: [],
      log_path: e.log_path
    });
  }
}

describe("playbook.buildPlaybook", () => {
  it("returns empty roles when no jobs", () => {
    const pb = buildPlaybook();
    expect(pb.roles).toEqual({});
  });

  it("computes success_rate and ranks targets per role", async () => {
    await seed([
      { target: "codex", role: "reviewer", ok: true },
      { target: "codex", role: "reviewer", ok: true },
      { target: "codex", role: "reviewer", ok: true },
      { target: "codex", role: "reviewer", ok: false },
      { target: "grok", role: "reviewer", ok: true },
      { target: "grok", role: "reviewer", ok: false }
    ]);
    const pb = buildPlaybook();
    const ranked = pb.roles.reviewer;
    expect(ranked[0].target).toBe("codex");
    expect(ranked[0].success_rate).toBeCloseTo(0.75, 2);
    expect(ranked[0].samples).toBe(4);
  });

  it("savePlaybook + loadPlaybook roundtrip", async () => {
    await seed([{ target: "codex", role: "reviewer", ok: true }]);
    const pb = buildPlaybook();
    savePlaybook(pb);
    const back = loadPlaybook();
    expect(back.roles.reviewer[0].target).toBe("codex");
  });
});

describe("playbook.pickByPlaybook override gate", () => {
  it("returns null when no playbook exists", () => {
    expect(pickByPlaybook({ role: "reviewer", staticOrder: ["codex", "grok"], availableTargets: ["codex", "grok"] })).toBeNull();
  });

  it("returns null when samples below threshold", async () => {
    await seed([
      { target: "grok", role: "reviewer", ok: true },
      { target: "grok", role: "reviewer", ok: true }
    ]);
    savePlaybook(buildPlaybook());
    const r = pickByPlaybook({ role: "reviewer", staticOrder: ["codex", "grok"], availableTargets: ["codex", "grok"] });
    expect(r).toBeNull();
  });

  it("returns override when learned target leads static head by ≥0.10", async () => {
    await seed([
      { target: "codex", role: "reviewer", ok: false },
      { target: "codex", role: "reviewer", ok: false },
      { target: "codex", role: "reviewer", ok: false },
      { target: "grok", role: "reviewer", ok: true },
      { target: "grok", role: "reviewer", ok: true },
      { target: "grok", role: "reviewer", ok: true }
    ]);
    savePlaybook(buildPlaybook());
    const r = pickByPlaybook({ role: "reviewer", staticOrder: ["codex", "grok"], availableTargets: ["codex", "grok"] });
    expect(r?.target).toBe("grok");
    expect(r.lead_over).toBe("codex");
  });
});

describe("dedup.findNearDuplicate (Jaccard)", () => {
  async function seedWithPayload(jobId, task, daysAgo = 0) {
    const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const logPath = path.join(tmpHome, `${jobId}.jsonl`);
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(logPath.replace(/\.jsonl$/, ".payload.json"), JSON.stringify({ task }));
    await appendJobIndex({ job_id: jobId, source: "cli", target: "codex", role: "reviewer", ok: true, started_at: ts, log_path: logPath });
  }

  it("returns null with no prior history", () => {
    expect(findNearDuplicate("anything goes here")).toBeNull();
  });

  it("finds near-duplicate above threshold", async () => {
    await seedWithPayload("j1", "review the redact module for security issues");
    const hit = findNearDuplicate("review redact module security issues");
    expect(hit).not.toBeNull();
    expect(hit.similarity).toBeGreaterThanOrEqual(0.7);
  });

  it("ignores prior outside the window", async () => {
    await seedWithPayload("j2", "review the redact module", 200);
    const hit = findNearDuplicate("review the redact module", { windowDays: 30 });
    expect(hit).toBeNull();
  });

  it("ignores below threshold", async () => {
    await seedWithPayload("j3", "review the redact module");
    const hit = findNearDuplicate("how does ACP protocol handle session cancel");
    expect(hit).toBeNull();
  });
});

describe("specialized roles registered", () => {
  it("test-writer / bisector / profiler in ROLE_NAMES with valid fallbacks", () => {
    for (const role of ["test-writer", "bisector", "profiler"]) {
      expect(ROLE_NAMES).toContain(role);
      expect(defaultTargetOrder(role).length).toBeGreaterThan(0);
    }
  });
});
