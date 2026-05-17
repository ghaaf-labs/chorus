import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveHome } from "./paths.mjs";
import { atomicWriteFile, backupOnce } from "./fs-util.mjs";
import { buildMarketplace, marketplaceDir, marketplaceExists, removeMarketplace } from "./marketplace.mjs";

export const host = "codex";

const MARKETPLACE = "chorus";
const PLUGIN_KEY = "chorus@chorus";

function configPath(home) {
  return path.join(home, ".codex", "config.toml");
}

function defaultRunner(args) {
  const bin = process.env.CHORUS_CODEX_BIN || "codex";
  const res = spawnSync(bin, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 60_000
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error?.message
  };
}

function defaultProbe() {
  const bin = process.env.CHORUS_CODEX_BIN || "codex";
  const res = spawnSync(bin, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 5_000 });
  return res.status === 0;
}

function isSectionHeader(line) {
  const t = line.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return false;
  if (t.startsWith("[[")) return true;
  return true;
}

function ensurePluginEnabled(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backupOnce(file);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const header = `[plugins."${PLUGIN_KEY}"]`;
  if (text.includes(header)) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) => l.trim() === header);
    if (i !== -1) {
      let j = i + 1;
      while (j < lines.length && !isSectionHeader(lines[j])) {
        if (/^\s*enabled\s*=/.test(lines[j])) {
          lines[j] = "enabled = true";
          atomicWriteFile(file, lines.join("\n"));
          return;
        }
        j++;
      }
      lines.splice(i + 1, 0, "enabled = true");
      atomicWriteFile(file, lines.join("\n"));
      return;
    }
  }
  const newBlock = `\n${header}\nenabled = true\n`;
  const next = text.endsWith("\n") || text.length === 0 ? text + newBlock : text + "\n" + newBlock;
  atomicWriteFile(file, next);
}

function removePluginBlock(file) {
  if (!fs.existsSync(file)) return;
  backupOnce(file);
  const original = fs.readFileSync(file, "utf8");
  const lines = original.split("\n");
  const header = `[plugins."${PLUGIN_KEY}"]`;
  const i = lines.findIndex((l) => l.trim() === header);
  if (i === -1) return;
  let j = i + 1;
  while (j < lines.length && !isSectionHeader(lines[j])) j++;
  lines.splice(i, j - i);
  const trailing = (original.match(/\n+$/) || [""])[0];
  const text = lines.join("\n").replace(/\n+$/, "") + trailing;
  atomicWriteFile(file, text);
}

export function status({ home: homeOverride } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "n/a", reason: "no_home" };
  const cfg = configPath(home);
  const text = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "";
  const hasPlugin = text.includes(`[plugins."${PLUGIN_KEY}"]`);
  const hasMarketplace = marketplaceExists({ home, host });
  if (!hasPlugin && !hasMarketplace) return { host, status: "not_registered" };
  if (!hasPlugin || !hasMarketplace) return { host, status: "registered_stale", reason: hasPlugin ? "marketplace missing" : "plugin entry missing" };
  return { host, status: "registered", dest: marketplaceDir(home, host) };
}

export function install({
  home: homeOverride,
  mode = "copy",
  dryRun = false,
  force = false,
  runner = defaultRunner,
  probe = defaultProbe
} = {}) {
  void force;
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  if (dryRun) {
    return { host, status: "would_install", marketplace: marketplaceDir(home, host), mode };
  }
  if (!probe()) {
    return { host, status: "error", reason: "codex CLI not on PATH (set CHORUS_CODEX_BIN or install codex-cli)" };
  }
  const built = buildMarketplace({ home, host, mode });
  const addRes = runner(["plugin", "marketplace", "add", built.marketplace]);
  if (!addRes.ok && !/already added|already exists/i.test(addRes.stdout + addRes.stderr)) {
    return { host, status: "error", reason: `marketplace add failed: ${(addRes.stderr || addRes.stdout || addRes.error || "").split("\n")[0]}` };
  }
  ensurePluginEnabled(configPath(home));
  return { host, status: "installed", marketplace: built.marketplace, plugin: built.plugin, mode };
}

export function uninstall({
  home: homeOverride,
  dryRun = false,
  runner = defaultRunner,
  probe = defaultProbe
} = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  if (dryRun) {
    return { host, status: "would_uninstall", marketplace: marketplaceDir(home, host) };
  }
  removePluginBlock(configPath(home));
  if (probe() && marketplaceExists({ home, host })) {
    runner(["plugin", "marketplace", "remove", MARKETPLACE]);
  }
  removeMarketplace({ home, host });
  return { host, status: "uninstalled", marketplace: marketplaceDir(home, host) };
}
