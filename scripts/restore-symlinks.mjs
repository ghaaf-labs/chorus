#!/usr/bin/env node
// Inverse of materialize-symlinks.mjs. Restores adapter directory symlinks
// after npm has snapshotted the package contents.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const STATE_DIR = path.join(REPO_ROOT, ".pack-state");
const STATE_FILE = path.join(STATE_DIR, "symlinks.json");

async function run() {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(await fsp.readFile(STATE_FILE, "utf8"));
  for (const entry of state.symlinks ?? []) {
    const p = path.join(REPO_ROOT, entry.path);
    await fsp.rm(p, { recursive: true, force: true });
    await fsp.symlink(entry.target, p, "dir");
    console.error(`restored symlink: ${p} → ${entry.target}`);
  }
  await fsp.rm(STATE_DIR, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(`restore-symlinks: ${err.stack || err.message}`);
  process.exit(1);
});
