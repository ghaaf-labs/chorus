import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SUBPROCESS } from "./driver.mjs";

export const id = "knowledge";
export const runModes = [SUBPROCESS];

const DEFAULT_LIMIT = 5;

function resolveKnowledgeIndexPath() {
  if (process.env.CHORUS_KNOWLEDGE_INDEX_PATH) return process.env.CHORUS_KNOWLEDGE_INDEX_PATH;
  const candidates = [
    // peer of chorus/ inside the workspace
    path.resolve(process.cwd(), "..", "tools", "knowledge-index"),
    path.resolve(process.cwd(), "tools", "knowledge-index"),
    path.join(os.homedir(), "Documents", "ghaaf", "tools", "knowledge-index")
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "pyproject.toml"))) return c;
    } catch { /* ignore */ }
  }
  return null;
}

export function buildInvocation({ mode, prompt, task, model: _model }) {
  if (mode !== SUBPROCESS) {
    throw new Error(`knowledge driver does not support mode "${mode}"`);
  }
  const kiPath = resolveKnowledgeIndexPath();
  if (!kiPath) {
    throw new Error("knowledge-index project not found; set CHORUS_KNOWLEDGE_INDEX_PATH");
  }
  // Prefer raw task when provided. Fallback to extracting <task>...</task>
  // from the composed prompt for older callers.
  let query = (task && task.trim()) || extractTaskFromPrompt(prompt) || "";
  query = query.trim();
  if (!query) {
    throw new Error("knowledge driver requires a non-empty query");
  }
  return {
    command: "uv",
    args: ["run", "--directory", kiPath, "knowledge", "search", query, "--limit", String(DEFAULT_LIMIT), "--no-telemetry"],
    stdin: ""
  };
}

function extractTaskFromPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const m = prompt.match(/<task>\s*([\s\S]*?)\s*<\/task>/);
  return m ? m[1] : null;
}

export function extractAssistant(runResult, mode) {
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  const raw = (runResult.stdout || "").trim();
  if (!raw) return "";
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return raw;
  }
  return JSON.stringify(mapToRetrieverSchema(obj));
}

export function extractTokens(runResult, mode) {
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  // Knowledge-index is a retrieval engine, not an LLM — no token usage. The
  // The generic token fallback in invoke.mjs will tag this as estimated.
  return { input: 0, output: 0, total: 0 };
}

/**
 * Map knowledge-index search JSON to Chorus's retriever role schema.
 * Verified hands-on 2026-05-16 against the live 9643-chunk Qdrant index.
 */
export function mapToRetrieverSchema(ki) {
  const status = ki?.status ?? "no_evidence";
  const results = Array.isArray(ki?.results) ? ki.results : [];
  const verdict = status === "ok"
    ? "approve"
    : (status === "low_confidence" ? "needs-attention" : "inconclusive");
  const chunks = results.map((r) => ({
    path: String(r.source_path ?? ""),
    score: Number.isFinite(r.score) ? r.score : 0,
    excerpt: String(r.text ?? "").slice(0, 4000),
    ...(Array.isArray(r.heading_path) && r.heading_path.length ? { heading_path: r.heading_path } : {}),
    ...(r.doc_type ? { doc_type: String(r.doc_type) } : {})
  }));
  // Confidence proxy: scores are unbounded RRF (observed max ~8.7); cap at 10.
  const topScore = chunks.length ? chunks[0].score : 0;
  const confidence = Math.max(0, Math.min(1, topScore / 10));
  return { chunks, confidence, verdict };
}
