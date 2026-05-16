/**
 * Task deduplication via Jaccard similarity over normalized token sets.
 *
 * Cheaper than embeddings, no extra dependency. Catches near-duplicate
 * questions in the last N days; the user can `--force` to override.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_THRESHOLD = 0.7;

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

function tokenize(text) {
  if (typeof text !== "string") return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9_\-\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function payloadFor(logPath) {
  if (!logPath) return null;
  const p = logPath.replace(/\.jsonl$/, ".payload.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* ignore */ }
  return null;
}

export function findNearDuplicate(task, { windowDays = DEFAULT_WINDOW_DAYS, threshold = DEFAULT_THRESHOLD } = {}) {
  if (typeof task !== "string" || !task.trim()) return null;
  const cutoff = Date.now() - windowDays * 86400_000;
  const queryTokens = tokenize(task);
  if (queryTokens.size < 2) return null;

  let best = null;
  for (const f of jobsFiles()) {
    const raw = fs.readFileSync(f, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e.started_at || Date.parse(e.started_at) < cutoff) continue;
      const payload = payloadFor(e.log_path);
      const priorTask = payload?.task;
      if (typeof priorTask !== "string") continue;
      const sim = jaccard(queryTokens, tokenize(priorTask));
      if (sim >= threshold && (!best || sim > best.similarity)) {
        best = { job_id: e.job_id, similarity: sim, started_at: e.started_at, target: e.target, role: e.role, prior_task: priorTask };
      }
    }
  }
  return best;
}
