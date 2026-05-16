#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { main } from "../src/cli.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CHORUS_REPO_ROOT ||= path.resolve(here, "..", "..");

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`chorus-core: ${err?.stack || err?.message || err}\n`);
    process.exit(1);
  }
);
