import fs from "node:fs";
import path from "node:path";
import { adapterSource, resolveHome } from "./paths.mjs";
import { destBelongsToChorus, installToDest, removeDest } from "./fs-util.mjs";

export const host = "grok";

function destPath(home) {
  return path.join(home, ".grok", "plugins", "chorus");
}

export function status({ home: homeOverride } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "n/a", reason: "no_home" };
  const dest = destPath(home);
  if (!destBelongsToChorus(dest)) return { host, status: "not_registered", dest };
  return { host, status: "registered", dest };
}

export function install({ home: homeOverride, mode = "copy", dryRun = false, force = false } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  const src = adapterSource("grok");
  const dest = destPath(home);
  if (fs.existsSync(dest) && !destBelongsToChorus(dest) && !force) {
    return { host, status: "error", dest, reason: "dest exists and is not chorus; pass --force to overwrite" };
  }
  if (dryRun) {
    return { host, status: "would_install", dest, src, mode };
  }
  installToDest({ src, dest, mode });
  return { host, status: "installed", dest, mode };
}

export function uninstall({ home: homeOverride, dryRun = false, force = false } = {}) {
  const home = resolveHome(homeOverride);
  if (!home) return { host, status: "error", reason: "no_home" };
  const dest = destPath(home);
  if (dryRun) {
    return { host, status: "would_uninstall", dest };
  }
  if (fs.existsSync(dest) && !destBelongsToChorus(dest) && !force) {
    return { host, status: "skipped", dest, reason: "dest is not chorus; pass --force to remove" };
  }
  removeDest(dest);
  return { host, status: "uninstalled", dest };
}
