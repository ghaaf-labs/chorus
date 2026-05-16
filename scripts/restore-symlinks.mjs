#!/usr/bin/env node
// Inverse of postpack.mjs. Restores adapter directory symlinks from the
// .symlink.bak files left behind by postpack.mjs. Used in dev workflows
// where `npm pack` has been run but you want to keep editing role/command
// markdown in a single place.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const ADAPTERS = ["claude", "codex", "grok"];
const SUBDIRS = ["agents", "commands", "skills"];

async function run() {
  for (const adapter of ADAPTERS) {
    for (const sub of SUBDIRS) {
      const p = path.join(REPO_ROOT, "adapters", adapter, sub);
      const bak = `${p}.symlink.bak`;
      if (!fs.existsSync(bak)) continue;
      const target = (await fsp.readFile(bak, "utf8")).trim();
      await fsp.rm(p, { recursive: true, force: true });
      await fsp.symlink(target, p, "dir");
      await fsp.unlink(bak);
      console.error(`restored symlink: ${p} → ${target}`);
    }
  }
}

run().catch((err) => {
  console.error(`restore-symlinks: ${err.stack || err.message}`);
  process.exit(1);
});
