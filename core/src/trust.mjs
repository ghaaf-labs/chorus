/**
 * Chorus Trust v1 — measurement layer for cross-vendor safety.
 *
 * Composes the M6.5 primitives (canary + redact + verdict normalization +
 * vendor capability matrix) into a single signed report card that can be
 * piped into CI or aggregated cross-team.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJobIndex } from "./logging.mjs";
import { CANARY_TOKENS, scanForBreaches } from "./canary.mjs";
import { loadPlaybook } from "./playbook.mjs";

function trustDir() {
  return path.join(os.homedir(), ".chorus", "trust");
}

export function listBreachesInJobs({ since } = {}) {
  const sinceMs = since ?? null;
  const filter = (e) =>
    e.ok !== undefined && e.started_at &&
    (sinceMs === null || Date.parse(e.started_at) >= sinceMs);
  const entries = readJobIndex({ limit: 5000, filter });
  // Load payload sidecars to scan stdout for breach tokens.
  const breaches = [];
  for (const e of entries) {
    if (!e.log_path) continue;
    const p = e.log_path.replace(/\.jsonl$/, ".payload.json");
    try {
      if (!fs.existsSync(p)) continue;
      const payload = JSON.parse(fs.readFileSync(p, "utf8"));
      const hits = scanForBreaches(payload.stdout ?? "");
      if (hits.length) {
        breaches.push({
          job_id: e.job_id, target: e.target, role: e.role,
          started_at: e.started_at, tokens: hits.map((h) => h.token)
        });
      }
    } catch { /* skip */ }
  }
  return breaches;
}

export function detectVerdictDrift({ since } = {}) {
  const sinceMs = since ?? null;
  const filter = (e) =>
    e.started_at && (sinceMs === null || Date.parse(e.started_at) >= sinceMs);
  const entries = readJobIndex({ limit: 5000, filter });
  // Group by (target, role); detect ok→fail or verdict flips for replayed pairs.
  const byParent = new Map();
  for (const e of entries) {
    const parents = Array.isArray(e.parent_job_ids) ? e.parent_job_ids : (e.parent_job_id ? [e.parent_job_id] : []);
    for (const p of parents) {
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(e);
    }
  }
  const drift = [];
  for (const e of entries) {
    const children = byParent.get(e.job_id) ?? [];
    for (const c of children) {
      if (c.target !== e.target || c.role !== e.role) continue;
      // Same (target, role) but different outcome → drift event.
      if (c.ok !== e.ok) {
        drift.push({
          parent_job_id: e.job_id,
          child_job_id: c.job_id,
          target: e.target,
          role: e.role,
          before: { ok: e.ok, at: e.started_at },
          after: { ok: c.ok, at: c.started_at }
        });
      }
    }
  }
  return drift;
}

export function buildTrustReport({ since } = {}) {
  const sinceMs = since ? Date.now() - since : null;
  const breaches = listBreachesInJobs({ since: sinceMs });
  const drift = detectVerdictDrift({ since: sinceMs });
  const playbook = loadPlaybook();
  return {
    chorus_version: "0.1.0",
    generated_at: new Date().toISOString(),
    window_ms: since ?? null,
    breaches,
    drift_events: drift,
    playbook_snapshot: playbook,
    summary: {
      breach_count: breaches.length,
      drift_count: drift.length,
      vendors_seen: [...new Set([
        ...breaches.map((b) => b.target),
        ...drift.map((d) => d.target)
      ])]
    }
  };
}

export function saveTrustReport(report) {
  const dir = trustDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.generated_at.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  return file;
}

/**
 * Look at the most recent report (or build one if absent) and decide
 * whether CI should pass.
 *   - breach_count > 0   → fail
 *   - drift_count > N    → fail
 *
 * Returns { pass: boolean, reasons: string[] }.
 */
export function ciGate({ maxDrift = 0, since = 24 * 3600 * 1000 } = {}) {
  const report = buildTrustReport({ since });
  const reasons = [];
  if (report.summary.breach_count > 0) {
    reasons.push(`canary breaches detected: ${report.summary.breach_count}`);
  }
  if (report.summary.drift_count > maxDrift) {
    reasons.push(`verdict drift events: ${report.summary.drift_count} > ${maxDrift}`);
  }
  return { pass: reasons.length === 0, reasons, report };
}
