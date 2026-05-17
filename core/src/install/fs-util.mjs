import fs from "node:fs";
import path from "node:path";
import { chorusRoot } from "./paths.mjs";

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
  const body = JSON.stringify({
    name: "chorus",
    ...payload,
    installedAt: new Date().toISOString()
  }, null, 2) + "\n";
  atomicWriteFile(file, body);
}

function readMarker(dir) {
  const file = path.join(dir, CHORUS_MARKER);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function hasMarker(dir) {
  const data = readMarker(dir);
  return data?.name === "chorus";
}

export function atomicWriteFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // best-effort: new file gets default umask
  }
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const fd = fs.openSync(tmp, "w", mode ?? 0o644);
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  if (mode !== undefined) {
    try { fs.chmodSync(file, mode); } catch { /* best-effort */ }
  }
}

export function installToDest({ src, dest, mode }) {
  if (mode !== "copy" && mode !== "link") {
    throw new Error(`installToDest: bad mode '${mode}'`);
  }
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  if (mode === "link") {
    if (fs.existsSync(dest) || isSymlink(dest)) removeDest(dest);
    try {
      fs.symlinkSync(src, dest);
      return;
    } catch (err) {
      if (err.code !== "EPERM") throw err;
    }
  }
  const tmp = fs.mkdtempSync(path.join(parent, ".chorus-installing-"));
  const tmpInner = path.join(tmp, "payload");
  const oldBackup = path.join(tmp, "old");
  let movedOld = false;
  try {
    deepCopyMaterialized(src, tmpInner);
    writeMarker(tmpInner, { source: src, mode });
    if (fs.existsSync(dest) || isSymlink(dest)) {
      fs.renameSync(dest, oldBackup);
      movedOld = true;
    }
    try {
      fs.renameSync(tmpInner, dest);
      movedOld = false;
    } catch (renameErr) {
      if (movedOld) {
        try { fs.renameSync(oldBackup, dest); } catch { /* leave backup for recovery */ }
        movedOld = false;
      }
      throw renameErr;
    }
  } finally {
    if (movedOld && fs.existsSync(oldBackup)) {
      try { fs.renameSync(oldBackup, dest); } catch { /* recovery best-effort */ }
    }
    removeDest(tmp);
  }
}

function deepCopyMaterialized(src, dest, visited = new Set()) {
  const real = fs.realpathSync(src);
  if (visited.has(real)) return;
  visited.add(real);
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(s), fs.readlinkSync(s));
        deepCopyMaterialized(resolved, d, visited);
      } else if (entry.isDirectory()) {
        deepCopyMaterialized(s, d, visited);
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

let cachedAdaptersReal = null;
function adaptersRealPath() {
  if (cachedAdaptersReal === null) {
    try {
      cachedAdaptersReal = fs.realpathSync(path.join(chorusRoot(), "adapters"));
    } catch {
      cachedAdaptersReal = "";
    }
  }
  return cachedAdaptersReal;
}

function pathsEqual(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathStartsWith(child, parent) {
  if (process.platform === "win32") {
    return child.toLowerCase().startsWith(parent.toLowerCase());
  }
  return child.startsWith(parent);
}

function isUnderChorusAdapters(absPath) {
  try {
    const adapters = adaptersRealPath();
    if (!adapters) return false;
    const real = fs.realpathSync(absPath);
    return pathsEqual(real, adapters) || pathStartsWith(real, adapters + path.sep);
  } catch {
    return false;
  }
}

export function destBelongsToChorus(dest) {
  if (!fs.existsSync(dest) && !isSymlink(dest)) return false;
  if (isSymlink(dest)) {
    const target = readlinkOrNull(dest);
    if (!target) return false;
    const resolved = path.resolve(path.dirname(dest), target);
    if (hasMarker(resolved)) return true;
    return isUnderChorusAdapters(resolved);
  }
  return hasMarker(dest);
}
