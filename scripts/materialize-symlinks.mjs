#!/usr/bin/env node
// Replace adapter directory symlinks with real file copies so the npm tarball
// is portable. Symlinks don't survive `npm pack` on all platforms (Windows in
// particular). Run via package prepack before publishing.
//
// Each adapter under adapters/<host>/{agents,commands,skills} is a symlink
// pointing into shared/. After this script runs:
//   - The original symlink targets are saved outside packaged paths
//   - The symlink path is replaced with a real directory containing copies
// Use restore-symlinks.mjs (companion script) to revert in dev.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const ADAPTERS = ["claude", "codex", "grok"];
const SUBDIRS = ["agents", "commands", "skills"];
const STATE_DIR = path.join(REPO_ROOT, ".pack-state");
const STATE_FILE = path.join(STATE_DIR, "symlinks.json");

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(s);
      const resolved = path.resolve(path.dirname(s), target);
      const stat = await fsp.stat(resolved);
      if (stat.isDirectory()) {
        await copyDir(resolved, d);
      } else {
        await fsp.copyFile(resolved, d);
      }
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

async function materialize(symlinkPath, state) {
  const lstat = await fsp.lstat(symlinkPath);
  if (!lstat.isSymbolicLink()) {
    console.error(`skip (not a symlink): ${symlinkPath}`);
    return;
  }
  const target = await fsp.readlink(symlinkPath);
  const resolved = path.resolve(path.dirname(symlinkPath), target);
  state.push({ path: path.relative(REPO_ROOT, symlinkPath), target });
  await fsp.unlink(symlinkPath);
  await copyDir(resolved, symlinkPath);
  console.error(`materialized: ${symlinkPath} ← ${target}`);
}

async function run() {
  const state = [];
  await fsp.rm(STATE_DIR, { recursive: true, force: true });
  await fsp.mkdir(STATE_DIR, { recursive: true });
  for (const adapter of ADAPTERS) {
    for (const sub of SUBDIRS) {
      const p = path.join(REPO_ROOT, "adapters", adapter, sub);
      if (!fs.existsSync(p)) continue;
      const lstat = await fsp.lstat(p);
      if (lstat.isSymbolicLink()) {
        await materialize(p, state);
      }
    }
  }
  await fsp.writeFile(STATE_FILE, JSON.stringify({ symlinks: state }, null, 2));
}

run().catch((err) => {
  console.error(`materialize-symlinks: ${err.stack || err.message}`);
  process.exit(1);
});
