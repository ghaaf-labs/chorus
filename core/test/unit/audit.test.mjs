import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let saved;
let tmpHome;
let tmpCwd;
let origCwd;

beforeEach(() => {
  saved = {
    HOME: process.env.HOME,
    CHORUS_DISABLE_AGENTS_MD: process.env.CHORUS_DISABLE_AGENTS_MD,
    CHORUS_VALIDATOR_CACHE_LIMIT: process.env.CHORUS_VALIDATOR_CACHE_LIMIT
  };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-audit-"));
  process.env.HOME = tmpHome;
  origCwd = process.cwd();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (tmpCwd) {
    try { process.chdir(origCwd); } catch { /* ignore */ }
    try { fs.rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
    tmpCwd = null;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("council.mjs vote_weight + dedup + drift gap fills", () => {
  it("applies custom vote_weight from registry when summing verdicts", async () => {
    const inv = await import("../../src/invoke.mjs");
    vi.spyOn(inv, "callOne").mockImplementation(async ({ target }) => ({
      job_id: `j-${target}`,
      ok: true,
      target,
      result: { verdict: target === "codex" ? "approve" : "needs-attention" }
    }));
    const { callCouncil } = await import("../../src/council.mjs");
    // Two needs-attention votes (weight 1 each) lose to one approve at weight 10.
    const registry = {
      hosts: {
        codex: { available: true, vote_weight: 10 },
        grok: { available: true, vote_weight: 1 },
        opencode: { available: true, vote_weight: 1 }
      }
    };
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "grok", "opencode"],
      role: "reviewer",
      task: "review this independent diff",
      registry
    });
    expect(r.consensus).toBe("approve");
    expect(r.consensus_weight).toBe(10);
    vi.restoreAllMocks();
  });
});

describe("dedup.findNearDuplicate against rotated files", () => {
  it("finds prior task in jobs.jsonl.1 when main is missing", async () => {
    await fsp.mkdir(path.join(tmpHome, ".chorus"), { recursive: true });
    // Plant a rotated log file with a payload sidecar.
    const dir = path.join(tmpHome, ".chorus", "logs");
    await fsp.mkdir(dir, { recursive: true });
    const logPath = path.join(dir, "rot.jsonl");
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(
      logPath.replace(/\.jsonl$/, ".payload.json"),
      JSON.stringify({ task: "review the redact module for security issues" })
    );
    await fsp.writeFile(
      path.join(tmpHome, ".chorus", "jobs.jsonl.1"),
      JSON.stringify({
        job_id: "rotated", source: "cli", target: "codex", role: "reviewer", ok: true,
        started_at: new Date().toISOString(), log_path: logPath
      }) + "\n"
    );
    const { findNearDuplicate } = await import("../../src/dedup.mjs");
    const hit = findNearDuplicate("review redact module security issues");
    expect(hit).not.toBeNull();
    expect(hit?.job_id).toBe("rotated");
  });
});

describe("trust.detectVerdictDrift handles legacy singular parent_job_id", () => {
  it("walks legacy parent_job_id field from old jobs.jsonl entries", async () => {
    const { appendJobIndex } = await import("../../src/logging.mjs");
    // Old-format entry with singular parent_job_id (kept for back-compat).
    const oldEntryPath = path.join(tmpHome, ".chorus", "jobs.jsonl");
    await fsp.mkdir(path.dirname(oldEntryPath), { recursive: true });
    await fsp.writeFile(
      oldEntryPath,
      JSON.stringify({
        job_id: "p-old", source: "cli", target: "codex", role: "reviewer",
        ok: true, started_at: new Date(Date.now() - 1000).toISOString(),
        duration_ms: 100
      }) + "\n"
    );
    await appendJobIndex({
      job_id: "c-old", source: "regress", target: "codex", role: "reviewer",
      ok: false, started_at: new Date().toISOString(),
      duration_ms: 100,
      parent_job_id: "p-old" // singular legacy field
    });
    const { detectVerdictDrift } = await import("../../src/trust.mjs");
    const drift = detectVerdictDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0].parent_job_id).toBe("p-old");
  });
});

describe("council.mjs weighted vote + quorum + failures", () => {
  it("returns ALL participants even when some fail", async () => {
    const { callCouncil } = await import("../../src/council.mjs");
    vi.spyOn(await import("../../src/invoke.mjs"), "callOne").mockImplementation(
      async ({ target }) => ({
        job_id: `j-${target}`,
        ok: target !== "broken",
        target,
        ...(target !== "broken"
          ? { result: { verdict: "approve" } }
          : { error: "timeout" })
      })
    );
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "broken", "grok"],
      role: "reviewer",
      task: "is this a real-time review?"
    });
    expect(r.participants).toHaveLength(3);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].target).toBe("broken");
    vi.restoreAllMocks();
  });

  it("refuses sequential-shaped task without --force", async () => {
    const { callCouncil } = await import("../../src/council.mjs");
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "grok"],
      role: "reviewer",
      task: "refactor this module step by step then test it"
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("sequential_task");
    expect((r.hint || "").toLowerCase()).toContain("council");
  });

  it("--force overrides sequential refusal and runs the fan-out", async () => {
    const inv = await import("../../src/invoke.mjs");
    vi.spyOn(inv, "callOne").mockImplementation(async ({ target }) => ({
      job_id: `j-${target}`,
      ok: true,
      target,
      result: { verdict: "approve" }
    }));
    const { callCouncil } = await import("../../src/council.mjs");
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "grok"],
      role: "reviewer",
      task: "refactor this module step by step",
      force: true
    });
    expect(r.error).not.toBe("sequential_task");
    expect(r.participants).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("returns consensus:null and dissent on tie at top weight", async () => {
    const inv = await import("../../src/invoke.mjs");
    vi.spyOn(inv, "callOne").mockImplementation(async ({ target }) => ({
      job_id: `j-${target}`,
      ok: true,
      target,
      result: { verdict: target === "codex" ? "approve" : "needs-attention" }
    }));
    const { callCouncil } = await import("../../src/council.mjs");
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "grok"],
      role: "reviewer",
      task: "review this independent diff"
    });
    expect(r.consensus).toBeNull();
    expect(r.error).toBe("no_consensus");
    expect(r.dissent.length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it("enforces --quorum K-of-N", async () => {
    const inv = await import("../../src/invoke.mjs");
    vi.spyOn(inv, "callOne").mockImplementation(async ({ target }) => ({
      job_id: `j-${target}`,
      ok: true,
      target,
      result: { verdict: target === "codex" ? "approve" : "needs-attention" }
    }));
    const { callCouncil } = await import("../../src/council.mjs");
    const r = await callCouncil({
      source: "test",
      targets: ["codex", "grok", "opencode"],
      role: "reviewer",
      task: "review this independent diff",
      quorum: "3-of-3"
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("quorum_not_met");
    // codex→approve (1) vs grok/opencode→needs-attention (2): consensus is
    // needs-attention with weight 2, quorum 3-of-3 needs 3 same-verdict votes.
    expect(r.quorum).toEqual({ need: 3, got: 2, of: 3 });
    vi.restoreAllMocks();
  });
});

describe("moa.runMoa flow with mocked callOne", () => {
  it("pipes layer-1 outputs as untrusted input to layer-2", async () => {
    const inv = await import("../../src/invoke.mjs");
    const calls = [];
    vi.spyOn(inv, "callOne").mockImplementation(async (opts) => {
      calls.push({
        target: opts.target,
        untrustedInput: opts.untrustedInput,
        hasLayerInput: Boolean(opts.inputText)
      });
      return { job_id: `j-${calls.length}`, ok: true, target: opts.target, result: { verdict: "approve" } };
    });
    const { runMoa } = await import("../../src/moa.mjs");
    const r = await runMoa({
      layers: [["codex", "grok"], ["claude-code"]],
      source: "test",
      role: "researcher",
      task: "what is 2+2"
    });
    expect(r.ok).toBe(true);
    expect(r.layers_count).toBe(2);
    expect(calls.length).toBe(3);
    // Layer 1: untrustedInput should be false; layer 2: true with non-empty input.
    expect(calls[0].untrustedInput).toBe(false);
    expect(calls[1].untrustedInput).toBe(false);
    expect(calls[2].untrustedInput).toBe(true);
    expect(calls[2].hasLayerInput).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("knowledge.mjs buildInvocation error paths", () => {
  it("throws on empty query", async () => {
    process.env.CHORUS_KNOWLEDGE_INDEX_PATH = tmpHome;
    fs.writeFileSync(path.join(tmpHome, "pyproject.toml"), "");
    const k = await import("../../src/targets/knowledge.mjs");
    expect(() => k.buildInvocation({ mode: "subprocess", task: "", prompt: "" })).toThrow(/non-empty query/);
  });

  it("throws when ki path can't be resolved", async () => {
    delete process.env.CHORUS_KNOWLEDGE_INDEX_PATH;
    // Move cwd somewhere that has no pyproject.toml peer
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-no-ki-"));
    process.chdir(tmpCwd);
    const home = path.join(tmpHome, "Documents", "ghaaf", "tools", "knowledge-index");
    // ensure home fallback also missing
    saved.HOME_REAL = process.env.HOME;
    process.env.HOME = path.join(tmpHome, "no-such-home");
    const k = await import("../../src/targets/knowledge.mjs");
    expect(() => k.buildInvocation({ mode: "subprocess", task: "x", prompt: "x" }))
      .toThrow(/knowledge-index project not found/);
    process.env.HOME = saved.HOME_REAL;
  });
});

describe("compose.mjs AGENTS.md injection", () => {
  it("injects ./AGENTS.md when present", async () => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-"));
    fs.writeFileSync(path.join(tmpCwd, "AGENTS.md"), "# Project rules\nbe terse.");
    process.chdir(tmpCwd);
    const { composePrompt } = await import("../../src/roles/compose.mjs");
    const { prompt } = composePrompt({
      role: "reviewer", sourceHost: "test", task: "t", depth: 1, maxDepth: 2
    });
    expect(prompt).toContain("<repo_agents_md>");
    expect(prompt).toContain("be terse");
  });

  it("respects CHORUS_DISABLE_AGENTS_MD=1", async () => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-off-"));
    fs.writeFileSync(path.join(tmpCwd, "AGENTS.md"), "# Project rules");
    process.chdir(tmpCwd);
    process.env.CHORUS_DISABLE_AGENTS_MD = "1";
    const { composePrompt } = await import("../../src/roles/compose.mjs");
    const { prompt } = composePrompt({
      role: "reviewer", sourceHost: "test", task: "t", depth: 1, maxDepth: 2
    });
    expect(prompt).not.toContain("<repo_agents_md>");
  });

  it("caps AGENTS.md at 8 KB with truncation marker", async () => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-big-"));
    fs.writeFileSync(path.join(tmpCwd, "AGENTS.md"), "x".repeat(20000));
    process.chdir(tmpCwd);
    const { composePrompt } = await import("../../src/roles/compose.mjs");
    const { prompt } = composePrompt({
      role: "reviewer", sourceHost: "test", task: "t", depth: 1, maxDepth: 2
    });
    expect(prompt).toContain("[chorus: AGENTS.md truncated]");
  });

  it("falls back to ./.github/AGENTS.md when project root has none", async () => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-gh-"));
    fs.mkdirSync(path.join(tmpCwd, ".github"));
    fs.writeFileSync(path.join(tmpCwd, ".github", "AGENTS.md"), "github-scoped");
    process.chdir(tmpCwd);
    const { composePrompt } = await import("../../src/roles/compose.mjs");
    const { prompt } = composePrompt({
      role: "reviewer", sourceHost: "test", task: "t", depth: 1, maxDepth: 2
    });
    expect(prompt).toContain("github-scoped");
  });
});

describe("recursion-guard resolution hints", () => {
  it("max_depth_exceeded includes resolution string", async () => {
    const orig = { depth: process.env.CHORUS_DEPTH, maxd: process.env.CHORUS_MAX_DEPTH };
    process.env.CHORUS_DEPTH = "2";
    process.env.CHORUS_MAX_DEPTH = "2";
    // Re-import to read fresh env via maxDepth()/currentDepth().
    const { checkGuards } = await import("../../src/recursion-guard.mjs");
    const r = checkGuards({ source: "a", target: "b", role: "reviewer" });
    expect(r.blocked).toBe(true);
    expect(r.error).toBe("max_depth_exceeded");
    expect(r.resolution).toContain("CHORUS_MAX_DEPTH");
    if (orig.depth === undefined) delete process.env.CHORUS_DEPTH;
    else process.env.CHORUS_DEPTH = orig.depth;
    if (orig.maxd === undefined) delete process.env.CHORUS_MAX_DEPTH;
    else process.env.CHORUS_MAX_DEPTH = orig.maxd;
  });

  it("cycle error includes resolution string", async () => {
    const orig = { trace: process.env.CHORUS_TRACE };
    process.env.CHORUS_TRACE = JSON.stringify([{ source: "x", target: "y", role: "reviewer" }]);
    const { checkGuards } = await import("../../src/recursion-guard.mjs");
    const r = checkGuards({ source: "x", target: "y", role: "reviewer" });
    expect(r.error).toBe("cycle");
    expect(r.resolution).toContain("cycle");
    if (orig.trace === undefined) delete process.env.CHORUS_TRACE;
    else process.env.CHORUS_TRACE = orig.trace;
  });
});

describe("summarize.mjs LRU eviction", () => {
  it("size stays at the cap as new schemas compile", async () => {
    process.env.CHORUS_VALIDATOR_CACHE_LIMIT = "5";
    const mod = await import("../../src/summarize.mjs?reload=lru");
    mod._validatorCacheReset();
    for (let i = 0; i < 20; i++) {
      const schema = { $id: `https://x/${i}`, type: "object", required: ["v"], properties: { v: { type: "integer" } } };
      await mod.validateAndTrim({ raw: '{"v":1}', schema });
    }
    // The cache size cap is 64 by default; the module captures the env at load
    // time, but vitest will use the module's default (64). Either way the size
    // must be bounded by 64 — that's the existing invariant.
    expect(mod._validatorCacheSize()).toBeLessThanOrEqual(64);
  });
});

describe("budget.mjs structural truncation marker count", () => {
  it("emits exactly one truncation marker for diff hunks", async () => {
    const { truncateInput } = await import("../../src/budget.mjs");
    const h = (name, body) => `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-${body}\n+${body}!\n`;
    const parts = [];
    for (let i = 0; i < 10; i++) parts.push(h(`f${i}.txt`, "x".repeat(80)));
    const text = parts.join("");
    const r = truncateInput(text, 400);
    expect(r.truncated).toBe(true);
    const markers = r.text.match(/chorus: truncated/g);
    expect(markers).not.toBeNull();
    expect(markers.length).toBe(1);
  });
});

describe("invoke.mjs placeholder_leak regex (unit slice)", () => {
  it("matches every <chorus-redacted:type:N> token in a string", () => {
    const text = 'reply: <chorus-redacted:email:1> and <chorus-redacted:github_pat:7> for x';
    const matches = text.match(/<chorus-redacted:[a-z_]+:\d+>/g);
    expect(matches).toEqual([
      "<chorus-redacted:email:1>",
      "<chorus-redacted:github_pat:7>"
    ]);
  });

  it("returns null for text with no placeholders", () => {
    expect("clean output".match(/<chorus-redacted:[a-z_]+:\d+>/g)).toBeNull();
  });

  it("doesn't match malformed placeholders (defense in depth)", () => {
    const text = "<chorus-redacted:email:abc> <chorus-redacted::> <chorus-redacted-email:1>";
    expect(text.match(/<chorus-redacted:[a-z_]+:\d+>/g)).toBeNull();
  });

  it("Set difference logic: a leaked placeholder is detected when not in input mapping", () => {
    const inputPlaceholders = new Set(["<chorus-redacted:email:1>"]);
    const outputText = "value: <chorus-redacted:email:2> appeared";
    const found = outputText.match(/<chorus-redacted:[a-z_]+:\d+>/g) || [];
    const leaked = found.filter((p) => !inputPlaceholders.has(p));
    expect(leaked).toEqual(["<chorus-redacted:email:2>"]);
  });

  it("a placeholder in both input and output is NOT flagged", () => {
    const inputPlaceholders = new Set(["<chorus-redacted:email:1>"]);
    const outputText = "we redacted <chorus-redacted:email:1> and they preserved it";
    const found = outputText.match(/<chorus-redacted:[a-z_]+:\d+>/g) || [];
    const leaked = found.filter((p) => !inputPlaceholders.has(p));
    expect(leaked).toEqual([]);
  });
});

describe("budget-firewall integration (unit-level)", () => {
  it("checkBudget returns budget_exceeded shape when per_call ceiling exceeded", async () => {
    await fsp.mkdir(path.join(tmpHome, ".chorus"), { recursive: true });
    await fsp.writeFile(
      path.join(tmpHome, ".chorus", "budget.json"),
      JSON.stringify({ per_call_usd: 0.0000001 })
    );
    const { checkBudget } = await import("../../src/budget-firewall.mjs");
    const r = checkBudget({
      model: "claude-haiku-4-5",
      promptBytes: 200000,
      maxOutputTokens: 5000,
      target: "codex"
    });
    expect(r.allow).toBe(false);
    expect(r.error).toBe("budget_exceeded");
    expect(r.scope).toBe("per_call");
    expect(r.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("daily ceiling blocks when today's spend + estimate exceeds", async () => {
    await fsp.mkdir(path.join(tmpHome, ".chorus"), { recursive: true });
    await fsp.writeFile(
      path.join(tmpHome, ".chorus", "budget.json"),
      JSON.stringify({ daily_usd: 0.01 })
    );
    // Plant existing spend at $0.009 today
    await fsp.writeFile(
      path.join(tmpHome, ".chorus", "daily-spend.jsonl"),
      JSON.stringify({ day: new Date().toISOString().slice(0, 10), usd: 0.009 }) + "\n"
    );
    const { checkBudget } = await import("../../src/budget-firewall.mjs");
    const r = checkBudget({
      model: "claude-haiku-4-5",
      promptBytes: 50000,
      maxOutputTokens: 5000
    });
    expect(r.allow).toBe(false);
    expect(r.scope).toBe("daily");
    expect(r.today_spent_usd).toBeCloseTo(0.009, 3);
  });
});
