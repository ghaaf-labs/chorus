import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let cached = null;

export function loadPricing() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(path.join(here, "pricing.json"), "utf8"));
  } catch {
    cached = { models: { default: { input: 0.005, output: 0.020 } } };
  }
  return cached;
}

export function estimateCostUsd({ model, tokens }) {
  if (!tokens || !tokens.total) return 0;
  const pricing = loadPricing();
  const rate = pricing.models[model] || pricing.models.default;
  return ((tokens.input * rate.input) + (tokens.output * rate.output)) / 1000;
}
