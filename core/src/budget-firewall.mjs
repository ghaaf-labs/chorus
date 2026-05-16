/**
 * Cost firewall — pre-spawn budget enforcement.
 *
 * ~/.chorus/budget.json shape (all fields optional):
 *   {
 *     "daily_usd": 1.00,           // max spend per UTC day
 *     "per_call_usd": 0.10,        // max spend per single callOne
 *     "per_council_usd": 0.50,     // max spend for a chorus council
 *     "warn_only": false           // log but don't reject
 *   }
 *
 * Pre-flight estimate: input_tokens ≈ ceil(prompt_bytes/4); we don't know
 * output tokens yet, so we use maxTokens as the worst-case ceiling.
 * The estimate uses pricing.json rates with a 1.3× safety margin so the
 * ACP-estimated path doesn't false-allow.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPricing } from "./pricing.mjs";

const SAFETY_MARGIN = 1.3;

function budgetPath() {
  return process.env.CHORUS_BUDGET_PATH || path.join(os.homedir(), ".chorus", "budget.json");
}

function dailyLedgerPath() {
  return process.env.CHORUS_SPEND_LEDGER_PATH || path.join(os.homedir(), ".chorus", "daily-spend.jsonl");
}

export function loadBudget() {
  try {
    const p = budgetPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function readTodaySpend() {
  try {
    if (!fs.existsSync(dailyLedgerPath())) return 0;
    const today = todayUtc();
    let sum = 0;
    for (const line of fs.readFileSync(dailyLedgerPath(), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.day === today) sum += r.usd || 0;
      } catch { /* skip */ }
    }
    return sum;
  } catch {
    return 0;
  }
}

export function recordSpend(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  try {
    fs.mkdirSync(path.dirname(dailyLedgerPath()), { recursive: true, mode: 0o700 });
    fs.appendFileSync(dailyLedgerPath(), JSON.stringify({ day: todayUtc(), usd, ts: new Date().toISOString() }) + "\n");
  } catch (err) {
    // Don't lose the spend silently; warn so daily-ledger problems are visible.
    try { process.stderr.write(`chorus: recordSpend failed (${err?.message ?? err})\n`); } catch { /* swallow */ }
  }
}

export function estimatePreflightCost({ model, promptBytes, maxOutputTokens }) {
  const pricing = loadPricing();
  const rate = pricing.models[model] || pricing.models.default;
  const inputTokens = Math.ceil((promptBytes || 0) / 4);
  const outputTokens = Math.max(0, maxOutputTokens ?? 0);
  return ((inputTokens * rate.input) + (outputTokens * rate.output)) / 1000 * SAFETY_MARGIN;
}

/**
 * Returns { allow, error?, hint?, estimated_cost_usd, ceiling_usd }.
 * If budget.json is absent or warn_only=true and ceiling exceeded, allow=true.
 */
export function checkBudget({ model, promptBytes, maxOutputTokens, target: _target }) {
  const budget = loadBudget();
  if (!budget) return { allow: true };
  const estimated = estimatePreflightCost({ model, promptBytes, maxOutputTokens });

  if (budget.per_call_usd && estimated > budget.per_call_usd) {
    if (budget.warn_only) {
      return { allow: true, warning: `per_call_usd exceeded estimate=$${estimated.toFixed(4)} ceiling=$${budget.per_call_usd}` };
    }
    return {
      allow: false,
      error: "budget_exceeded",
      hint: `Per-call ceiling exceeded: estimate=$${estimated.toFixed(4)} > ceiling=$${budget.per_call_usd}. Edit ~/.chorus/budget.json or pass a cheaper --model.`,
      estimated_cost_usd: estimated,
      ceiling_usd: budget.per_call_usd,
      scope: "per_call"
    };
  }

  if (budget.daily_usd) {
    const todaySpend = readTodaySpend();
    if (todaySpend + estimated > budget.daily_usd) {
      if (budget.warn_only) {
        return { allow: true, warning: `daily_usd ceiling exceeded today=$${todaySpend.toFixed(4)} + est=$${estimated.toFixed(4)} > $${budget.daily_usd}` };
      }
      return {
        allow: false,
        error: "budget_exceeded",
        hint: `Daily ceiling exceeded: today=$${todaySpend.toFixed(4)} + estimate=$${estimated.toFixed(4)} > $${budget.daily_usd}. Wait until UTC tomorrow or raise the ceiling.`,
        estimated_cost_usd: estimated,
        today_spent_usd: todaySpend,
        ceiling_usd: budget.daily_usd,
        scope: "daily"
      };
    }
  }

  return { allow: true, estimated_cost_usd: estimated };
}
