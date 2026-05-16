import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { truncateDeep, DEFAULTS } from "./budget.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validatorCache = new Map();

function getValidator(schema) {
  const key = schema.$id || JSON.stringify(schema).slice(0, 64);
  if (!validatorCache.has(key)) {
    validatorCache.set(key, ajv.compile(schema));
  }
  return validatorCache.get(key);
}

export function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to fence + best-effort parsing */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch { /* continue */ }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch { /* continue */ }
  }

  return null;
}

export function validateAndTrim({ raw, schema, maxChars = DEFAULTS.summary_max_chars }) {
  const parsed = extractJsonObject(raw);
  if (parsed === null) {
    return {
      ok: false,
      error: "schema_violation",
      reason: "could_not_parse_json",
      raw_excerpt: typeof raw === "string" ? raw.slice(0, 2048) : ""
    };
  }
  const validate = getValidator(schema);
  if (!validate(parsed)) {
    return {
      ok: false,
      error: "schema_violation",
      reason: "schema_invalid",
      validator_errors: validate.errors,
      raw_excerpt: JSON.stringify(parsed).slice(0, 2048)
    };
  }
  const fieldsTruncated = [];
  const trimmed = truncateDeep(parsed, maxChars, fieldsTruncated);
  return { ok: true, result: trimmed, fields_truncated: fieldsTruncated };
}
