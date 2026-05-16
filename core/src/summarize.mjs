import { truncateDeep, DEFAULTS } from "./budget.mjs";

let ajvInstance = null;
const VALIDATOR_CACHE_LIMIT = Number.parseInt(process.env.CHORUS_VALIDATOR_CACHE_LIMIT ?? "64", 10);
const validatorCache = new Map(); // LRU via insertion-order Map semantics

async function getAjv() {
  if (ajvInstance) return ajvInstance;
  const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([
    import("ajv/dist/2020.js"),
    import("ajv-formats")
  ]);
  ajvInstance = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajvInstance);
  return ajvInstance;
}

async function getValidator(schema) {
  const key = schema.$id || JSON.stringify(schema).slice(0, 64);
  if (validatorCache.has(key)) {
    // LRU touch: re-insert to move to end.
    const v = validatorCache.get(key);
    validatorCache.delete(key);
    validatorCache.set(key, v);
    return v;
  }
  const ajv = await getAjv();
  const validator = ajv.compile(schema);
  validatorCache.set(key, validator);
  if (validatorCache.size > VALIDATOR_CACHE_LIMIT) {
    // Evict oldest (first inserted) entry.
    const oldest = validatorCache.keys().next().value;
    validatorCache.delete(oldest);
  }
  return validator;
}

export function _validatorCacheSize() { return validatorCache.size; }
export function _validatorCacheReset() { validatorCache.clear(); }

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

export async function validateAndTrim({ raw, schema, maxChars = DEFAULTS.summary_max_chars }) {
  const parsed = extractJsonObject(raw);
  if (parsed === null) {
    return {
      ok: false,
      error: "schema_violation",
      reason: "could_not_parse_json",
      raw_excerpt: typeof raw === "string" ? raw.slice(0, 2048) : ""
    };
  }
  const validate = await getValidator(schema);
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
