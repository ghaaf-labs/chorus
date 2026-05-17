import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as claude from "../../src/install/claude.mjs";
import * as codex from "../../src/install/codex.mjs";
import * as grok from "../../src/install/grok.mjs";
import * as opencode from "../../src/install/opencode.mjs";
import { installAll, uninstallAll, statusAll, HOSTS } from "../../src/install/index.mjs";
import { buildMarketplace, marketplaceDir } from "../../src/install/marketplace.mjs";
import { CHORUS_MARKER, atomicWriteFile, destBelongsToChorus, hasMarker, writeMarker } from "../../src/install/fs-util.mjs";
import { chorusRoot } from "../../src/install/paths.mjs";

let tmpHome;
let savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-install-"));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function fakeRunner(captured) {
  return (args) => {
    captured.push(args);
    return { ok: true, stdout: "", stderr: "" };
  };
}

const okProbe = () => true;
const nopeProbe = () => false;

describe("destBelongsToChorus + marker", () => {
  it("marker presence + valid name proves ownership", () => {
    const dir = path.join(tmpHome, "x");
    fs.mkdirSync(dir, { recursive: true });
    writeMarker(dir);
    expect(hasMarker(dir)).toBe(true);
    expect(destBelongsToChorus(dir)).toBe(true);
  });

  it("a marker file with wrong name does NOT prove ownership", () => {
    const dir = path.join(tmpHome, "y");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, CHORUS_MARKER), JSON.stringify({ name: "not-chorus" }));
    expect(hasMarker(dir)).toBe(false);
    expect(destBelongsToChorus(dir)).toBe(false);
  });

  it("a plugin.json manifest alone is NOT enough — only marker counts", () => {
    const dir = path.join(tmpHome, "z");
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "chorus" }));
    expect(destBelongsToChorus(dir)).toBe(false);
  });

  it("symlink pointing INSIDE the chorus adapters/ tree counts as ours", () => {
    const link = path.join(tmpHome, "sym");
    const target = path.join(chorusRoot(), "adapters", "claude");
    fs.symlinkSync(target, link);
    expect(destBelongsToChorus(link)).toBe(true);
  });

  it("symlink to a path with /adapters/ in the name but NOT inside chorus is NOT ours", () => {
    const fakeAdapters = path.join(tmpHome, "user-app", "adapters", "thing");
    fs.mkdirSync(fakeAdapters, { recursive: true });
    const link = path.join(tmpHome, "sym2");
    fs.symlinkSync(fakeAdapters, link);
    expect(destBelongsToChorus(link)).toBe(false);
  });
});

describe("atomicWriteFile", () => {
  it("preserves the original file's mode", () => {
    const f = path.join(tmpHome, "perm.txt");
    fs.writeFileSync(f, "old");
    fs.chmodSync(f, 0o600);
    atomicWriteFile(f, "new");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(f, "utf8")).toBe("new");
  });

  it("creates parent directories as needed", () => {
    const f = path.join(tmpHome, "a", "b", "c.txt");
    atomicWriteFile(f, "x");
    expect(fs.readFileSync(f, "utf8")).toBe("x");
  });

  it("does not leave the temp file behind", () => {
    const f = path.join(tmpHome, "ok.txt");
    atomicWriteFile(f, "content");
    const siblings = fs.readdirSync(tmpHome);
    expect(siblings.filter((s) => s.startsWith("ok.txt.tmp"))).toEqual([]);
  });

  it("new file uses 0o644 default mode (modulo umask)", () => {
    const f = path.join(tmpHome, "new.txt");
    atomicWriteFile(f, "x");
    const expected = 0o644 & ~process.umask();
    expect(fs.statSync(f).mode & 0o777).toBe(expected);
  });
});

describe("opencode header marker", () => {
  it("classifies a BOM-prefixed installed file as ours", () => {
    const dir = path.join(tmpHome, ".config", "opencode", "agent");
    fs.mkdirSync(dir, { recursive: true });
    opencode.install({ home: tmpHome });
    const f = path.join(dir, "chorus-reviewer.md");
    const orig = fs.readFileSync(f, "utf8");
    fs.writeFileSync(f, String.fromCharCode(0xFEFF) + orig);
    const result = opencode.status({ home: tmpHome });
    expect(result.status).toBe("registered");
  });
});

describe("marketplace builder", () => {
  it("creates a Claude-style marketplace.json at .claude-plugin/marketplace.json", () => {
    const r = buildMarketplace({ home: tmpHome, host: "claude" });
    const manifest = JSON.parse(fs.readFileSync(path.join(r.marketplace, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(manifest.name).toBe("chorus");
    expect(manifest.owner.name).toBe("Ghaaf");
    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0].source).toBe("./plugins/chorus");
    expect(fs.existsSync(path.join(r.plugin, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("creates a Codex-style marketplace.json at .agents/plugins/marketplace.json", () => {
    const r = buildMarketplace({ home: tmpHome, host: "codex" });
    const manifest = JSON.parse(fs.readFileSync(path.join(r.marketplace, ".agents", "plugins", "marketplace.json"), "utf8"));
    expect(manifest.plugins[0].source.source).toBe("local");
    expect(manifest.plugins[0].source.path).toBe("./plugins/chorus");
    expect(fs.existsSync(path.join(r.plugin, ".codex-plugin", "plugin.json"))).toBe(true);
  });

  it("materializes shared/ symlinks into real files", () => {
    const r = buildMarketplace({ home: tmpHome, host: "claude" });
    const commandsDir = path.join(r.plugin, "commands");
    expect(fs.lstatSync(commandsDir).isDirectory()).toBe(true);
    expect(fs.lstatSync(commandsDir).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(commandsDir, "review.md"))).toBe(true);
  });
});

describe("claude install", () => {
  it("shells out to claude CLI to add marketplace + install plugin", () => {
    const captured = [];
    const r = claude.install({ home: tmpHome, runner: fakeRunner(captured), probe: okProbe });
    expect(r.status).toBe("installed");
    expect(captured[0]).toEqual(["plugin", "marketplace", "add", marketplaceDir(tmpHome, "claude")]);
    expect(captured[1]).toEqual(["plugin", "install", "chorus@chorus", "--scope", "user"]);
    expect(fs.existsSync(path.join(marketplaceDir(tmpHome, "claude"), ".claude-plugin", "marketplace.json"))).toBe(true);
  });

  it("errors when claude CLI is not available", () => {
    const r = claude.install({ home: tmpHome, runner: fakeRunner([]), probe: nopeProbe });
    expect(r.status).toBe("error");
    expect(r.reason).toMatch(/claude CLI/);
  });

  it("treats 'already added' marketplace as success", () => {
    const runner = (args) => {
      if (args.includes("marketplace") && args.includes("add")) {
        return { ok: false, stderr: "marketplace already added", stdout: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    };
    const r = claude.install({ home: tmpHome, runner, probe: okProbe });
    expect(r.status).toBe("installed");
  });

  it("dry-run returns plan without shelling out", () => {
    const captured = [];
    const r = claude.install({ home: tmpHome, dryRun: true, runner: fakeRunner(captured), probe: okProbe });
    expect(r.status).toBe("would_install");
    expect(captured).toHaveLength(0);
    expect(fs.existsSync(marketplaceDir(tmpHome, "claude"))).toBe(false);
  });

  it("uninstall shells out to claude CLI then removes the marketplace dir", () => {
    claude.install({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    expect(fs.existsSync(marketplaceDir(tmpHome, "claude"))).toBe(true);
    const captured = [];
    claude.uninstall({ home: tmpHome, runner: fakeRunner(captured), probe: okProbe });
    expect(captured[0]).toEqual(["plugin", "uninstall", "chorus@chorus"]);
    expect(fs.existsSync(marketplaceDir(tmpHome, "claude"))).toBe(false);
  });

  it("uninstall sweeps the legacy chorus-owned ~/.claude/plugins/chorus dir", () => {
    const legacy = path.join(tmpHome, ".claude", "plugins", "chorus");
    fs.mkdirSync(legacy, { recursive: true });
    writeMarker(legacy);
    claude.uninstall({ home: tmpHome, runner: fakeRunner([]), probe: nopeProbe });
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("uninstall does NOT delete a foreign ~/.claude/plugins/chorus dir without --force", () => {
    const legacy = path.join(tmpHome, ".claude", "plugins", "chorus");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "alien.txt"), "not chorus");
    claude.uninstall({ home: tmpHome, runner: fakeRunner([]), probe: nopeProbe });
    expect(fs.readFileSync(path.join(legacy, "alien.txt"), "utf8")).toBe("not chorus");
  });

  it("uninstall fallback backs up the registry and removes the cache dir", () => {
    const reg = path.join(tmpHome, ".claude", "plugins", "installed_plugins.json");
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({
      plugins: {
        "chorus@chorus": [{ scope: "user", installPath: "/x" }],
        "other@m": [{ scope: "user" }]
      }
    }));
    const cache = path.join(tmpHome, ".claude", "plugins", "cache", "chorus", "chorus", "0.1.0");
    fs.mkdirSync(cache, { recursive: true });
    claude.uninstall({ home: tmpHome, runner: fakeRunner([]), probe: nopeProbe });
    expect(fs.existsSync(`${reg}.bak`)).toBe(true);
    const remaining = JSON.parse(fs.readFileSync(reg, "utf8"));
    expect(remaining.plugins["chorus@chorus"]).toBeUndefined();
    expect(remaining.plugins["other@m"]).toBeTruthy();
    expect(fs.existsSync(cache)).toBe(false);
  });

  it("status reads installed_plugins.json registry", () => {
    expect(claude.status({ home: tmpHome }).status).toBe("not_registered");
    const reg = path.join(tmpHome, ".claude", "plugins", "installed_plugins.json");
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    const cache = path.join(tmpHome, ".claude", "plugins", "cache", "chorus", "chorus", "0.1.0");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({
      plugins: { "chorus@chorus": [{ scope: "user", installPath: cache, version: "0.1.0" }] }
    }));
    expect(claude.status({ home: tmpHome }).status).toBe("registered");
  });

  it("status reports stale when installPath is missing", () => {
    const reg = path.join(tmpHome, ".claude", "plugins", "installed_plugins.json");
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({
      plugins: { "chorus@chorus": [{ scope: "user", installPath: "/missing", version: "0.1.0" }] }
    }));
    expect(claude.status({ home: tmpHome }).status).toBe("registered_stale");
  });
});

describe("codex install", () => {
  it("shells out to codex CLI to add marketplace and writes plugin enable block", () => {
    const captured = [];
    const r = codex.install({ home: tmpHome, runner: fakeRunner(captured), probe: okProbe });
    expect(r.status).toBe("installed");
    expect(captured[0]).toEqual(["plugin", "marketplace", "add", marketplaceDir(tmpHome, "codex")]);
    const cfg = fs.readFileSync(path.join(tmpHome, ".codex", "config.toml"), "utf8");
    expect(cfg).toContain(`[plugins."chorus@chorus"]`);
    expect(cfg).toContain("enabled = true");
  });

  it("preserves existing config.toml content when adding plugin block", () => {
    const cfg = path.join(tmpHome, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, `model = "gpt-5.5"\n\n[plugins."linear@x"]\nenabled = true\n`);
    codex.install({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    const after = fs.readFileSync(cfg, "utf8");
    expect(after).toContain(`model = "gpt-5.5"`);
    expect(after).toContain(`[plugins."linear@x"]`);
    expect(after).toContain(`[plugins."chorus@chorus"]`);
  });

  it("is idempotent — no duplicate plugin block on re-install", () => {
    codex.install({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    codex.install({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    const cfg = fs.readFileSync(path.join(tmpHome, ".codex", "config.toml"), "utf8");
    expect((cfg.match(/\[plugins\."chorus@chorus"\]/g) || []).length).toBe(1);
  });

  it("uninstall removes plugin block and marketplace dir", () => {
    codex.install({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    codex.uninstall({ home: tmpHome, runner: fakeRunner([]), probe: okProbe });
    expect(fs.existsSync(marketplaceDir(tmpHome, "codex"))).toBe(false);
    const cfg = fs.readFileSync(path.join(tmpHome, ".codex", "config.toml"), "utf8");
    expect(cfg).not.toContain(`[plugins."chorus@chorus"]`);
  });

  it("errors when codex CLI is not on PATH", () => {
    const r = codex.install({ home: tmpHome, runner: fakeRunner([]), probe: nopeProbe });
    expect(r.status).toBe("error");
    expect(r.reason).toMatch(/codex CLI/);
  });
});

describe("grok install", () => {
  it("copies adapter into ~/.grok/plugins/chorus", () => {
    const r = grok.install({ home: tmpHome });
    expect(r.status).toBe("installed");
    expect(fs.existsSync(path.join(r.dest, ".grok-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(r.dest, "commands"))).toBe(true);
  });

  it("link mode creates a symlink", () => {
    const r = grok.install({ home: tmpHome, mode: "link" });
    expect(fs.lstatSync(r.dest).isSymbolicLink()).toBe(true);
  });

  it("writes a .chorus-install.json marker into the dest", () => {
    const r = grok.install({ home: tmpHome });
    expect(fs.existsSync(path.join(r.dest, ".chorus-install.json"))).toBe(true);
  });

  it("refuses to install over a non-chorus dest without --force", () => {
    const dest = path.join(tmpHome, ".grok", "plugins", "chorus");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "alien.txt"), "foreign");
    const r = grok.install({ home: tmpHome });
    expect(r.status).toBe("error");
    expect(fs.readFileSync(path.join(dest, "alien.txt"), "utf8")).toBe("foreign");
  });

  it("--force overrides the conflict", () => {
    const dest = path.join(tmpHome, ".grok", "plugins", "chorus");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "alien.txt"), "foreign");
    const r = grok.install({ home: tmpHome, force: true });
    expect(r.status).toBe("installed");
    expect(fs.existsSync(path.join(dest, "alien.txt"))).toBe(false);
  });

  it("uninstall removes a chorus-owned dest", () => {
    grok.install({ home: tmpHome });
    grok.uninstall({ home: tmpHome });
    expect(fs.existsSync(path.join(tmpHome, ".grok", "plugins", "chorus"))).toBe(false);
  });

  it("uninstall SKIPS a foreign dest without --force", () => {
    const dest = path.join(tmpHome, ".grok", "plugins", "chorus");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "alien.txt"), "foreign");
    const r = grok.uninstall({ home: tmpHome });
    expect(r.status).toBe("skipped");
    expect(fs.readFileSync(path.join(dest, "alien.txt"), "utf8")).toBe("foreign");
  });

  it("uninstall --force removes a foreign dest", () => {
    const dest = path.join(tmpHome, ".grok", "plugins", "chorus");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "alien.txt"), "foreign");
    const r = grok.uninstall({ home: tmpHome, force: true });
    expect(r.status).toBe("uninstalled");
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe("opencode install", () => {
  it("copies all four agent files into ~/.config/opencode/agent/", () => {
    const r = opencode.install({ home: tmpHome });
    expect(r.status).toBe("installed");
    for (const name of ["chorus-reviewer.md", "chorus-researcher.md", "chorus-architect.md", "chorus-devils-advocate.md"]) {
      expect(fs.existsSync(path.join(tmpHome, ".config", "opencode", "agent", name))).toBe(true);
    }
  });

  it("link mode creates symlinks", () => {
    opencode.install({ home: tmpHome, mode: "link" });
    const target = path.join(tmpHome, ".config", "opencode", "agent", "chorus-reviewer.md");
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
  });

  it("uninstall only removes our files, not foreign ones", () => {
    const dir = path.join(tmpHome, ".config", "opencode", "agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "my-custom.md"), "# my custom agent");
    opencode.install({ home: tmpHome });
    opencode.uninstall({ home: tmpHome });
    expect(fs.existsSync(path.join(dir, "my-custom.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "chorus-reviewer.md"))).toBe(false);
  });

  it("install preflights ALL target files before mutating any", () => {
    const dir = path.join(tmpHome, ".config", "opencode", "agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "chorus-architect.md"), "# foreign agent (not chorus)");
    const r = opencode.install({ home: tmpHome });
    expect(r.status).toBe("error");
    expect(fs.readFileSync(path.join(dir, "chorus-architect.md"), "utf8")).toBe("# foreign agent (not chorus)");
    expect(fs.existsSync(path.join(dir, "chorus-reviewer.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "chorus-researcher.md"))).toBe(false);
  });
});

describe("index orchestrator", () => {
  function runners() {
    return { claude: fakeRunner([]), codex: fakeRunner([]) };
  }

  it("installAll respects the probe — skips hosts not detected", () => {
    const probe = {
      "claude-code": { available: true },
      codex: { available: false },
      grok: { available: false },
      opencode: { available: false }
    };
    const results = installAll({ home: tmpHome, probe, runners: runners() });
    expect(results.find((r) => r.host === "claude").status).toBe("installed");
    for (const host of ["codex", "grok", "opencode"]) {
      expect(results.find((r) => r.host === host).status).toBe("skipped");
    }
  });

  it("installAll without probe attempts every host", () => {
    const results = installAll({ home: tmpHome, runners: runners() });
    expect(results.map((r) => r.host).sort()).toEqual(HOSTS.slice().sort());
    for (const r of results) {
      expect(["installed", "would_install"].includes(r.status)).toBe(true);
    }
  });

  it("statusAll reports all four hosts as not_registered on a fresh home", () => {
    const results = statusAll({ home: tmpHome });
    expect(results.every((r) => r.status === "not_registered")).toBe(true);
  });

  it("uninstallAll cleans every host (with stubbed runners)", () => {
    installAll({ home: tmpHome, runners: runners() });
    uninstallAll({ home: tmpHome, runners: runners() });
    const results = statusAll({ home: tmpHome });
    expect(results.every((r) => r.status === "not_registered")).toBe(true);
  });
});
