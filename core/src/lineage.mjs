import { findJobById } from "./replay.mjs";

/**
 * Build a DAG node from a job entry. Walks parent_job_ids recursively.
 * Cycle-safe (visited set keyed by job_id).
 * Tolerates legacy singular parent_job_id.
 */
export function buildLineage(jobId, { maxDepth = 32, visited = new Set() } = {}) {
  if (!jobId || visited.has(jobId) || maxDepth <= 0) {
    return { job_id: jobId, missing: true };
  }
  visited.add(jobId);
  const entry = findJobById(jobId);
  if (!entry) return { job_id: jobId, missing: true };
  const parents = Array.isArray(entry.parent_job_ids)
    ? entry.parent_job_ids
    : (entry.parent_job_id ? [entry.parent_job_id] : []);
  return {
    job_id: entry.job_id,
    source: entry.source,
    target: entry.target,
    role: entry.role,
    started_at: entry.started_at,
    ok: entry.ok,
    error: entry.error ?? null,
    duration_ms: entry.duration_ms,
    parents: parents.map((p) => buildLineage(p, { maxDepth: maxDepth - 1, visited }))
  };
}

export function lineageStats(node) {
  let depth = 0;
  let width = 0;
  function walk(n, d) {
    if (!n || n.missing) return;
    depth = Math.max(depth, d);
    if (Array.isArray(n.parents)) {
      width = Math.max(width, n.parents.length);
      for (const p of n.parents) walk(p, d + 1);
    }
  }
  walk(node, 1);
  return { depth, width };
}

export function renderAscii(node, prefix = "", isLast = true) {
  if (!node) return "";
  if (node.missing) return `${prefix}${isLast ? "└── " : "├── "}(missing ${node.job_id ?? "?"})\n`;
  const mark = node.ok ? "✓" : "✗";
  const head = `${prefix}${isLast ? "└── " : "├── "}${mark} ${node.job_id}  ${node.source}→${node.target}  ${node.role}\n`;
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  const parents = node.parents ?? [];
  return head + parents.map((p, i) => renderAscii(p, childPrefix, i === parents.length - 1)).join("");
}

export function renderMermaid(node) {
  const lines = ["graph BT"];
  const seen = new Set();
  function walk(n) {
    if (!n || n.missing || seen.has(n.job_id)) return;
    seen.add(n.job_id);
    const label = `${n.job_id}<br/>${n.source}→${n.target}<br/>${n.role}`;
    lines.push(`  ${n.job_id}["${label}"]`);
    for (const p of n.parents ?? []) {
      if (p && !p.missing) {
        lines.push(`  ${n.job_id} --> ${p.job_id}`);
      } else if (p?.job_id) {
        lines.push(`  ${n.job_id} --> ${p.job_id}["(missing ${p.job_id})"]`);
      }
      walk(p);
    }
  }
  walk(node);
  return lines.join("\n") + "\n";
}
