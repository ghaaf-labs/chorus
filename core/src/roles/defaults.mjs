import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = path.resolve(here, "..", "..", "..", "roles");
const SCHEMAS_DIR = path.resolve(here, "..", "schemas");

const ROLE_FALLBACKS = {
  reviewer: ["codex", "grok-build", "grok", "copilot", "opencode", "claude-code"],
  researcher: ["grok-build", "grok", "codex", "opencode", "claude-code"],
  architect: ["codex", "claude-code", "opencode", "grok-build", "grok"],
  "devils-advocate": ["grok-build", "grok", "codex", "claude-code", "opencode"],
  retriever: ["knowledge"],
  judge: ["claude-code", "codex", "grok-build", "grok", "opencode"],
  "refactor-scribe": ["copilot", "codex", "claude-code", "opencode"],
  "test-writer": ["codex", "claude-code", "copilot", "grok-build", "opencode"],
  bisector: ["codex", "claude-code", "grok-build", "opencode"],
  profiler: ["codex", "claude-code", "grok-build", "opencode"]
};

export const ROLE_NAMES = Object.keys(ROLE_FALLBACKS);

export function rolePath(name) {
  return path.join(ROLES_DIR, `${name}.md`);
}

export function schemaPath(role) {
  return path.join(SCHEMAS_DIR, `${role}.schema.json`);
}

export function defaultTargetOrder(role) {
  if (!ROLE_FALLBACKS[role]) {
    throw new Error(`unknown role: ${role}`);
  }
  return [...ROLE_FALLBACKS[role]];
}

export function loadRoleFile(name) {
  const p = rolePath(name);
  if (!fs.existsSync(p)) {
    throw new Error(`role file not found: ${p}`);
  }
  const raw = fs.readFileSync(p, "utf8");
  const fm = parseFrontmatter(raw);
  return {
    name,
    frontmatter: fm.frontmatter,
    body: fm.body,
    path: p
  };
}

function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!/^---\s*\n/.test(normalized)) {
    return { frontmatter: {}, body: normalized };
  }
  const fmStart = normalized.indexOf("\n") + 1;
  const endMatch = normalized.slice(fmStart).match(/\n---\s*\n/);
  if (!endMatch) {
    throw new Error("frontmatter has no closing --- delimiter");
  }
  const end = fmStart + endMatch.index;
  const fmRaw = normalized.slice(fmStart, end);
  const body = normalized.slice(end + endMatch[0].length);
  const frontmatter = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    frontmatter[m[1]] = value;
  }
  return { frontmatter, body };
}

const REVIEWER_TRIGGERS = /\b(diff|review|branch|pr\b|patch|commit|merge|regress|defect|vuln|security|bug)\b/i;
const RESEARCHER_TRIGGERS = /\b(research|investigate|how does|when did|why does|what is|cite|source|docs|documentation|find out)\b/i;
const ARCHITECT_TRIGGERS = /\b(design|architect|plan|propose|approach|structure|module|component)\b/i;
const DEVILS_ADVOCATE_TRIGGERS = /\b(critique|argue|counter|wrong|flaw|attack|criticize|hole|weakness|disagree)\b/i;

export function pickDefaultRole(taskText) {
  if (typeof taskText !== "string") return "researcher";
  if (DEVILS_ADVOCATE_TRIGGERS.test(taskText)) return "devils-advocate";
  if (REVIEWER_TRIGGERS.test(taskText)) return "reviewer";
  if (ARCHITECT_TRIGGERS.test(taskText)) return "architect";
  if (RESEARCHER_TRIGGERS.test(taskText)) return "researcher";
  return "researcher";
}

export function resolveTarget({ role, requested, registry, allowSelf = false, source }) {
  if (requested) {
    const host = registry?.hosts?.[requested];
    if (!host || !host.available) {
      return {
        error: "target_unavailable",
        target: requested,
        hint: "Run `chorus setup` to refresh capabilities."
      };
    }
    if (!allowSelf && requested === source) {
      return { error: "self_target", target: requested };
    }
    return { target: requested };
  }
  const order = defaultTargetOrder(role);
  for (const candidate of order) {
    if (!allowSelf && candidate === source) continue;
    if (registry?.hosts?.[candidate]?.available) {
      return { target: candidate };
    }
  }
  return {
    error: "no_available_target",
    attempted: order,
    hint: "Run `chorus setup` to refresh capabilities."
  };
}
