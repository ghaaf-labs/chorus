import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, "..", "..", "bin", "chorus");

let saved;
let tmpHome;

function chorus(args, env = {}) {
  return spawnSync(BIN, args, {
    encoding: "utf8",
    env: { ...process.env, HOME: tmpHome, CHORUS_PROBE_TIMEOUT_MS: "500", ...env },
    timeout: 15000
  });
}

beforeEach(() => {
  saved = { HOME: process.env.HOME };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-cli-e2e-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("chorus binary baseline", () => {
  it("`chorus version` prints version and exits 0", () => {
    const r = chorus(["version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/chorus \d+\.\d+\.\d+/);
  });

  it("`chorus help` lists the advanced workflow subcommands", () => {
    const r = chorus(["help"]);
    expect(r.status).toBe(0);
    for (const cmd of ["lineage", "playbook", "regress", "bulk-query", "dedup", "mcp", "trust", "drift", "canary", "init"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("`chorus unknown` exits 2 with USAGE", () => {
    const r = chorus(["unknown-subcommand"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown subcommand");
  });
});

describe("chorus lineage", () => {
  it("missing job_id → exit 2 with USAGE on stderr", () => {
    const r = chorus(["lineage"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("lineage <job_id>");
  });

  it("unknown job_id → exit 2 with 'no job found'", () => {
    const r = chorus(["lineage", "definitely-does-not-exist"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no job found");
  });
});

describe("chorus playbook", () => {
  it("`show` without a built playbook → exit 2 with hint", () => {
    const r = chorus(["playbook", "show"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("playbook rebuild");
  });

  it("`rebuild` against empty history writes a playbook", () => {
    const r = chorus(["playbook", "rebuild"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("wrote 0 roles");
    expect(fs.existsSync(path.join(tmpHome, ".chorus", "playbook.json"))).toBe(true);
  });
});

describe("chorus dedup", () => {
  it("missing --task → exit 2 with USAGE", () => {
    const r = chorus(["dedup"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("dedup");
  });

  it("empty history → exit 0 with 'no near-duplicate'", () => {
    const r = chorus(["dedup", "--task", "review some code"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no near-duplicate");
  });
});

describe("chorus trust + drift", () => {
  it("`trust` with no subcommand → exit 2 with USAGE", () => {
    const r = chorus(["trust"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("trust");
  });

  it("`trust --ci` on clean history → exit 0 PASS", () => {
    const r = chorus(["trust", "--ci"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  it("`trust report` writes a JSON report", () => {
    const r = chorus(["trust", "report", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.breach_count).toBe(0);
    expect(parsed.summary.drift_count).toBe(0);
  });

  it("`drift` on clean history → exit 0 'no drift events'", () => {
    const r = chorus(["drift"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no drift events");
  });
});

describe("chorus canary", () => {
  it("`canary check` on empty history → exit 0 'no breaches'", () => {
    const r = chorus(["canary", "check"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no breaches");
  });

  it("`canary fuzz` without --target → list-only, exit 0", () => {
    const r = chorus(["canary", "fuzz"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("variants generated");
    expect(r.stdout).toContain("Pass --target");
  });

  it("`canary` with no subcommand → exit 2 with USAGE", () => {
    const r = chorus(["canary"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("canary check");
  });
});

describe("chorus history with cost column + --since", () => {
  it("empty history → exit 0 'no recent jobs'", () => {
    const r = chorus(["status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no recent jobs");
  });

  it("bad --since spec → exit 2", () => {
    const r = chorus(["history", "--since", "garbage"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad --since");
  });
});

describe("chorus regress", () => {
  it("missing --since → exit 2 with USAGE", () => {
    const r = chorus(["regress"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("regress --since");
  });
});

describe("chorus bulk-query", () => {
  it("missing --file → exit 2 with USAGE", () => {
    const r = chorus(["bulk-query"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bulk-query");
  });
});

describe("chorus mcp (stub)", () => {
  it("prints stub placeholder, exit 0", () => {
    const r = chorus(["mcp"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("placeholder");
  });
});

describe("chorus replay error path", () => {
  it("missing job_id → exit 2 with USAGE", () => {
    const r = chorus(["replay"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("required");
  });

  it("unknown job_id → exit 2 'no job found'", () => {
    const r = chorus(["replay", "no-such-id"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no job found");
  });
});

describe("chorus doctor (no registry)", () => {
  it("runs without crashing and writes registry on first invocation", () => {
    const r = chorus(["doctor"]);
    // doctor either prints capability lines or shows targets as not_installed
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("chorus 0.1.0 — capability registry");
  });
});

describe("chorus init", () => {
  it("creates a budget template with --yes", () => {
    const r = chorus(["init", "--yes", "--skip-probe"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("chorus init");
    expect(fs.existsSync(path.join(tmpHome, ".chorus", "budget.json"))).toBe(true);
  });
});
