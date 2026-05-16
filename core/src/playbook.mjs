/**
 * Self-modifying playbook.
 *
 * Reads `~/.chorus/jobs.jsonl` (and rotated `.1..N`) and aggregates per
 * (role, target) success rate. Writes `~/.chorus/playbook.json` with the
 * current rankings. `resolveTarget` callers can consult `pickByPlaybook`
 * to override the static `ROLE_FALLBACKS` order when a learned target has
 * a meaningfully higher score (≥3 samples + ≥0.1 lead over static head).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MIN_SAMPLES = 3;
const SIG_LEAD = 0.1;

function playbookPath() {
  return path.join(os.homedir(), ".chorus", "playbook.json");
}

function jobsFiles() {
  const main = path.join(os.homedir(), ".chorus", "jobs.jsonl");
  const files = [];
  if (fs.existsSync(main)) files.push(main);
  for (let i = 1; i <= 32; i++) {
    const r = `${main}.${i}`;
    if (fs.existsSync(r)) files.push(r);
    else break;
  }
  return files;
}

export function buildPlaybook({ since } = {}) {
  const cutoffMs = since ? Date.now() - since : null;
  const counts = {}; // role → target → { ok, total }
  for (const f of jobsFiles()) {
    const raw = fs.readFileSync(f, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e.role || !e.target) continue;
      if (cutoffMs && e.started_at && Date.parse(e.started_at) < cutoffMs) continue;
      counts[e.role] = counts[e.role] || {};
      const slot = counts[e.role][e.target] = counts[e.role][e.target] || { ok: 0, total: 0 };
      slot.total++;
      if (e.ok) slot.ok++;
    }
  }
  const playbook = { generated_at: new Date().toISOString(), roles: {} };
  for (const [role, targets] of Object.entries(counts)) {
    const ranked = Object.entries(targets)
      .map(([t, c]) => ({ target: t, success_rate: c.total ? c.ok / c.total : 0, samples: c.total }))
      .sort((a, b) => b.success_rate - a.success_rate || b.samples - a.samples);
    playbook.roles[role] = ranked;
  }
  return playbook;
}

export function savePlaybook(pb) {
  const p = playbookPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(pb, null, 2) + "\n");
  return p;
}

export function loadPlaybook() {
  try {
    const p = playbookPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Given a role and the static fallback order, return a learned target name
 * when the playbook has meaningful signal (≥MIN_SAMPLES per target AND the
 * top playbook entry exceeds the static head by ≥SIG_LEAD success-rate).
 * Returns null if no override is warranted.
 */
export function pickByPlaybook({ role, staticOrder, availableTargets }) {
  const pb = loadPlaybook();
  if (!pb || !pb.roles?.[role]) return null;
  const eligible = pb.roles[role]
    .filter((r) => r.samples >= MIN_SAMPLES && availableTargets.includes(r.target));
  if (!eligible.length) return null;
  const best = eligible[0];
  const staticHead = staticOrder.find((t) => availableTargets.includes(t));
  if (!staticHead || best.target === staticHead) return null;
  const staticHeadEntry = eligible.find((r) => r.target === staticHead);
  const staticRate = staticHeadEntry?.success_rate ?? 0;
  if (best.success_rate - staticRate >= SIG_LEAD) {
    return { target: best.target, success_rate: best.success_rate, samples: best.samples, lead_over: staticHead };
  }
  return null;
}
