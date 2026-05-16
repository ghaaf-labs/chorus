import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifyTaskShape, shouldRefuseCouncil } from "../../src/task-shape.mjs";
import { buildLineage, lineageStats, renderAscii, renderMermaid } from "../../src/lineage.mjs";
import { appendJobIndex, jobsIndexPath } from "../../src/logging.mjs";

let saved;
let tmpHome;

beforeEach(() => {
  saved = { HOME: process.env.HOME };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-m7-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("task-shape.classifyTaskShape", () => {
  it("flags 'step by step refactor' as sequential", () => {
    const c = classifyTaskShape("refactor this module step by step");
    expect(c.shape).toBe("sequential");
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it("flags 'migrate the auth layer then test it' as sequential", () => {
    const c = classifyTaskShape("migrate the auth layer then test it");
    expect(c.shape).toBe("sequential");
  });

  it("flags 'review this diff' as parallel", () => {
    const c = classifyTaskShape("review this diff for security issues");
    expect(c.shape).toBe("parallel");
  });

  it("returns 'neutral' for ambiguous text with no markers", () => {
    const c = classifyTaskShape("what is the capital of France");
    expect(c.shape).toBe("neutral");
  });

  it("handles undefined / empty input safely", () => {
    expect(classifyTaskShape(undefined).shape).toBe("unknown");
    expect(classifyTaskShape("").shape).toBe("unknown");
  });
});

describe("task-shape.shouldRefuseCouncil", () => {
  it("refuses on sequential tasks above confidence threshold", () => {
    const r = shouldRefuseCouncil("step by step migrate the database");
    expect(r.refuse).toBe(true);
    expect(r.classifier.hint.toLowerCase()).toContain("council");
  });

  it("allows on parallel tasks", () => {
    const r = shouldRefuseCouncil("research the trade-offs of using sqlite");
    expect(r.refuse).toBe(false);
  });

  it("respects force:true", () => {
    const r = shouldRefuseCouncil("step by step migrate the database", { force: true });
    expect(r.refuse).toBe(false);
  });
});

describe("lineage.buildLineage", () => {
  async function seedJob(entry) {
    await appendJobIndex({
      job_id: entry.job_id,
      source: entry.source ?? "cli",
      target: entry.target ?? "codex",
      role: entry.role ?? "reviewer",
      ok: true,
      duration_ms: 100,
      started_at: new Date().toISOString(),
      parent_job_ids: entry.parents ?? []
    });
  }

  it("returns missing for unknown job_id", () => {
    const n = buildLineage("does-not-exist");
    expect(n.missing).toBe(true);
  });

  it("walks a 3-node chain via parent_job_ids", async () => {
    await seedJob({ job_id: "root", parents: [] });
    await seedJob({ job_id: "mid", parents: ["root"] });
    await seedJob({ job_id: "leaf", parents: ["mid"] });
    const tree = buildLineage("leaf");
    expect(tree.job_id).toBe("leaf");
    expect(tree.parents[0].job_id).toBe("mid");
    expect(tree.parents[0].parents[0].job_id).toBe("root");
  });

  it("handles legacy singular parent_job_id", async () => {
    const idx = jobsIndexPath();
    fs.mkdirSync(path.dirname(idx), { recursive: true });
    await fsp.writeFile(
      idx,
      JSON.stringify({ job_id: "old-leaf", source: "cli", target: "grok", role: "researcher", ok: true, parent_job_id: "old-root" }) + "\n" +
      JSON.stringify({ job_id: "old-root", source: "cli", target: "codex", role: "reviewer", ok: true }) + "\n"
    );
    const tree = buildLineage("old-leaf");
    expect(tree.parents).toHaveLength(1);
    expect(tree.parents[0].job_id).toBe("old-root");
  });

  it("is cycle-safe", async () => {
    await seedJob({ job_id: "a", parents: ["b"] });
    await seedJob({ job_id: "b", parents: ["a"] });
    const tree = buildLineage("a");
    expect(tree).toBeTruthy();
    // Both should be present once each; second visit short-circuits to missing-marker
  });

  it("stats reports depth and width", async () => {
    await seedJob({ job_id: "p1", parents: [] });
    await seedJob({ job_id: "p2", parents: [] });
    await seedJob({ job_id: "merge", parents: ["p1", "p2"] });
    const tree = buildLineage("merge");
    const s = lineageStats(tree);
    expect(s.width).toBeGreaterThanOrEqual(2);
    expect(s.depth).toBeGreaterThanOrEqual(2);
  });
});

describe("lineage rendering", () => {
  it("ascii output contains job ids and ok marker", async () => {
    await appendJobIndex({ job_id: "r1", source: "cli", target: "codex", role: "reviewer", ok: true, duration_ms: 100, parent_job_ids: [] });
    const tree = buildLineage("r1");
    const ascii = renderAscii(tree);
    expect(ascii).toContain("r1");
    expect(ascii).toContain("cli→codex");
  });

  it("mermaid output starts with graph BT", async () => {
    await appendJobIndex({ job_id: "m1", source: "cli", target: "codex", role: "reviewer", ok: true, duration_ms: 100, parent_job_ids: [] });
    const tree = buildLineage("m1");
    const mm = renderMermaid(tree);
    expect(mm.startsWith("graph BT")).toBe(true);
    expect(mm).toContain("m1");
  });
});

describe("council weighted consensus + quorum (callCouncil wiring smoke)", () => {
  it("module imports without throwing", async () => {
    const m = await import("../../src/council.mjs");
    expect(typeof m.callCouncil).toBe("function");
  });
});
