import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveHome } from "./paths.mjs";
import { atomicWriteFile, backupOnce, destBelongsToChorus } from "./fs-util.mjs";
import { buildMarketplace, marketplaceDir, marketplaceExists, removeMarketplace } from "./marketplace.mjs";

export const host = "claude";

const MARKETPLACE = "chorus";
const PLUGIN_KEY = "chorus@chorus";

function registryPath(home) {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

function readRegistry(file) {
  if (!fs.existsSync(file)) return { plugins: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data.plugins) data.plugins = {};
    return data;
  } catch {
    return { plugins: {} };
  }
}

function defaultRunner(args) {
  const bin = process.env.CHORUS_CLAUDE_BIN || "claude";
  const res = spawnSync(bin, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 60_000,
    env: { ...process.env, CLAUDE_CODE_SIMPLE: "1" }
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error?.message
  };
}

function defaultProbe() {
  const bin = process.env.CHORUS_CLAUDE_BIN || "claude";
  const res = spawnSync(bin, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 5_000 });
  return res.status === 0;
}

export function status({ home: homeOverride } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "n/a", reason: "no_home" };
  const reg = readRegistry(registryPath(home));
  const entry = reg.plugins[PLUGIN_KEY]?.[0];
  if (!entry) return { host, status: "not_registered", marketplace: marketplaceDir(home, host) };
  if (!fs.existsSync(entry.installPath)) {
    return { host, status: "registered_stale", reason: "installPath missing" };
  }
  return { host, status: "registered", dest: entry.installPath, version: entry.version };
}

export function install({
  home: homeOverride,
  mode = "copy",
  dryRun = false,
  force = false,
  runner = defaultRunner,
  probe = defaultProbe
} = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  if (dryRun) {
    return {
      host,
      status: "would_install",
      marketplace: marketplaceDir(home, host),
      plugin_key: PLUGIN_KEY,
      mode
    };
  }
  if (!probe()) {
    return { host, status: "error", reason: "claude CLI not on PATH (set CHORUS_CLAUDE_BIN or install claude-code)" };
  }
  const built = buildMarketplace({ home, host, mode });

  const addArgs = ["plugin", "marketplace", "add", built.marketplace];
  if (force) addArgs.push("--force");
  const addRes = runner(addArgs);
  if (!addRes.ok && !/already added|already exists/i.test(addRes.stdout + addRes.stderr)) {
    return { host, status: "error", reason: `marketplace add failed: ${(addRes.stderr || addRes.stdout || addRes.error || "").split("\n")[0]}` };
  }

  const installRes = runner(["plugin", "install", PLUGIN_KEY, "--scope", "user"]);
  if (!installRes.ok && !/already installed/i.test(installRes.stdout + installRes.stderr)) {
    return { host, status: "error", reason: `plugin install failed: ${(installRes.stderr || installRes.stdout || installRes.error || "").split("\n")[0]}` };
  }

  return { host, status: "installed", marketplace: built.marketplace, plugin: built.plugin, mode };
}

export function uninstall({
  home: homeOverride,
  dryRun = false,
  force = false,
  runner = defaultRunner,
  probe = defaultProbe
} = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  if (dryRun) {
    return { host, status: "would_uninstall", marketplace: marketplaceDir(home, host) };
  }
  if (probe()) {
    runner(["plugin", "uninstall", PLUGIN_KEY]);
    if (marketplaceExists({ home, host })) {
      runner(["plugin", "marketplace", "remove", MARKETPLACE]);
    }
  } else {
    const reg = registryPath(home);
    if (fs.existsSync(reg)) {
      backupOnce(reg);
      const data = readRegistry(reg);
      if (data.plugins[PLUGIN_KEY]) {
        delete data.plugins[PLUGIN_KEY];
        atomicWriteFile(reg, JSON.stringify(data, null, 2));
      }
    }
    const cache = path.join(home, ".claude", "plugins", "cache", "chorus");
    if (fs.existsSync(cache)) fs.rmSync(cache, { recursive: true, force: true });
  }
  removeMarketplace({ home, host });
  const legacy = path.join(home, ".claude", "plugins", "chorus");
  if (fs.existsSync(legacy) && (destBelongsToChorus(legacy) || force)) {
    fs.rmSync(legacy, { recursive: true, force: true });
  }
  return { host, status: "uninstalled", marketplace: marketplaceDir(home, host) };
}
