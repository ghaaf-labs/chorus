import fs from "node:fs";
import path from "node:path";
import { adapterSource, resolveHome } from "./paths.mjs";

export const host = "opencode";

const AGENTS = [
  "chorus-reviewer.md",
  "chorus-researcher.md",
  "chorus-architect.md",
  "chorus-devils-advocate.md"
];

function destDir(home) {
  return path.join(home, ".config", "opencode", "agent");
}

function sourceAgents() {
  return path.join(adapterSource("opencode"), "agents");
}

function isOurFile(target) {
  if (!fs.existsSync(target) && !isSymlink(target)) return false;
  try {
    if (isSymlink(target)) {
      const link = fs.readlinkSync(target);
      return link.includes("/adapters/opencode/agents/") || link.includes("/chorus/");
    }
    const content = fs.readFileSync(target, "utf8");
    return content.includes("chorus") && content.includes("Delegate");
  } catch {
    return false;
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function status({ home: homeOverride } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "n/a", reason: "no_home" };
  const dir = destDir(home);
  let installed = 0;
  let stale = 0;
  for (const name of AGENTS) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target) && !isSymlink(target)) continue;
    if (isOurFile(target)) installed++;
    else stale++;
  }
  if (installed === 0 && stale === 0) return { host, status: "not_registered", dest: dir };
  if (installed === AGENTS.length && stale === 0) return { host, status: "registered", dest: dir };
  return { host, status: "registered_stale", dest: dir, reason: `${installed}/${AGENTS.length} ours, ${stale} foreign` };
}

export function install({ home: homeOverride, mode = "copy", dryRun = false, force = false } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  const dir = destDir(home);
  const src = sourceAgents();
  if (dryRun) {
    return { host, status: "would_install", dest: dir, src, mode };
  }
  if (!force) {
    const conflicts = [];
    for (const name of AGENTS) {
      const target = path.join(dir, name);
      if ((fs.existsSync(target) || isSymlink(target)) && !isOurFile(target)) {
        conflicts.push(name);
      }
    }
    if (conflicts.length > 0) {
      return { host, status: "error", dest: dir, reason: `${conflicts.join(", ")} exist and are not chorus; pass --force` };
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const name of AGENTS) {
    const target = path.join(dir, name);
    const sourceFile = path.join(src, name);
    if (fs.existsSync(target) || isSymlink(target)) {
      if (isSymlink(target)) fs.unlinkSync(target);
      else fs.rmSync(target);
    }
    if (mode === "link") {
      try {
        fs.symlinkSync(sourceFile, target);
        continue;
      } catch (err) {
        if (err.code !== "EPERM") throw err;
      }
    }
    fs.copyFileSync(sourceFile, target);
  }
  return { host, status: "installed", dest: dir, mode };
}

export function uninstall({ home: homeOverride, dryRun = false } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  const dir = destDir(home);
  if (dryRun) {
    return { host, status: "would_uninstall", dest: dir };
  }
  for (const name of AGENTS) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target) && !isSymlink(target)) continue;
    if (!isOurFile(target)) continue;
    if (isSymlink(target)) fs.unlinkSync(target);
    else fs.rmSync(target);
  }
  return { host, status: "uninstalled", dest: dir };
}
