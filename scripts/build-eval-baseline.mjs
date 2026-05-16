#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const suitePath = path.join(root, "core", "test", "eval", "suite.json");
const baselinePath = path.join(root, "core", "test", "eval", "baseline.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildBaseline() {
  const suite = readJson(suitePath);
  const ids = new Set();
  const verdicts = {};
  for (const prompt of suite.prompts ?? []) {
    if (!prompt.id || ids.has(prompt.id)) throw new Error(`duplicate or missing prompt id: ${prompt.id}`);
    ids.add(prompt.id);
    if (!["approve", "needs-attention", "inconclusive"].includes(prompt.expected_verdict)) {
      throw new Error(`bad expected_verdict for ${prompt.id}`);
    }
    verdicts[prompt.id] = prompt.expected_verdict;
  }
  if (ids.size !== 20) throw new Error(`expected 20 eval prompts, found ${ids.size}`);
  return {
    version: suite.version,
    generated_at: new Date().toISOString(),
    generated_from: "suite.expected_verdict",
    verdicts
  };
}

function checkBaseline() {
  const expected = buildBaseline().verdicts;
  const actual = readJson(baselinePath).verdicts ?? {};
  const missing = [];
  const changed = [];
  for (const [id, verdict] of Object.entries(expected)) {
    if (!(id in actual)) missing.push(id);
    else if (actual[id] !== verdict) changed.push(`${id}: ${actual[id]} != ${verdict}`);
  }
  const extra = Object.keys(actual).filter((id) => !(id in expected));
  if (missing.length || changed.length || extra.length) {
    throw new Error([
      missing.length ? `missing: ${missing.join(", ")}` : null,
      changed.length ? `changed: ${changed.join(", ")}` : null,
      extra.length ? `extra: ${extra.join(", ")}` : null
    ].filter(Boolean).join("\n"));
  }
}

try {
  if (process.argv.includes("--write")) {
    fs.writeFileSync(baselinePath, JSON.stringify(buildBaseline(), null, 2) + "\n");
    console.log(`wrote ${baselinePath}`);
  } else {
    checkBaseline();
    console.log("eval baseline: PASS");
  }
} catch (err) {
  console.error(`eval baseline: FAIL\n${err.message}`);
  process.exit(1);
}
