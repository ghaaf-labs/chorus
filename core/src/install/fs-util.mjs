import fs from "node:fs";
import path from "node:path";

export const CHORUS_MARKER = ".chorus-install.json";

export function backupOnce(file) {
  if (!fs.existsSync(file)) return;
  const bak = `${file}.bak`;
  if (fs.existsSync(bak)) return;
  fs.copyFileSync(file, bak);
  try { fs.chmodSync(bak, 0o600); } catch { /* best-effort */ }
}

export function writeMarker(dir, payload = {}) {
  const file = path.join(dir, CHORUS_MARKER);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    name: "chorus",
    ...payload,
    installedAt: new Date().toISOString()
  }, null, 2) + "\n");
}

export function hasMarker(dir) {
  return fs.existsSync(path.join(dir, CHORUS_MARKER));
}

export function atomicWriteFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

export function installToDest({ src, dest, mode }) {
  if (mode !== "copy" && mode !== "link") {
    throw new Error(`installToDest: bad mode '${mode}'`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) || isSymlink(dest)) {
    removeDest(dest);
  }
  if (mode === "link") {
    try {
      fs.symlinkSync(src, dest);
      return;
    } catch (err) {
      if (err.code !== "EPERM") throw err;
    }
  }
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(parent, ".chorus-installing-"));
  const tmpInner = path.join(tmp, "payload");
  try {
    deepCopyMaterialized(src, tmpInner);
    writeMarker(tmpInner, { source: src, mode });
    fs.renameSync(tmpInner, dest);
  } finally {
    removeDest(tmp);
  }
}

function deepCopyMaterialized(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(s), fs.readlinkSync(s));
        deepCopyMaterialized(resolved, d);
      } else if (entry.isDirectory()) {
        deepCopyMaterialized(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
      }
    }
  } else if (stat.isFile()) {
    fs.copyFileSync(src, dest);
  }
}

export function removeDest(p) {
  if (!fs.existsSync(p) && !isSymlink(p)) return;
  if (isSymlink(p)) {
    fs.unlinkSync(p);
    return;
  }
  fs.rmSync(p, { recursive: true, force: true });
}

export function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function readlinkOrNull(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

export function destBelongsToChorus(dest) {
  if (!fs.existsSync(dest) && !isSymlink(dest)) return false;
  if (isSymlink(dest)) {
    const target = readlinkOrNull(dest);
    if (!target) return false;
    const resolved = path.resolve(path.dirname(dest), target);
    if (hasMarker(resolved)) return true;
    return target.includes("/adapters/") && target.endsWith(path.basename(target));
  }
  if (hasMarker(dest)) return true;
  for (const sub of [".claude-plugin", ".codex-plugin", ".grok-plugin"]) {
    const file = path.join(dest, sub, "plugin.json");
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data?.name === "chorus") return true;
    } catch {
      // ignore parse errors
    }
  }
  return false;
}
