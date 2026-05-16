/**
 * Prompt-firewall — opt-in PII / secret redaction before sending content to
 * any vendor. Replaces matches with stable placeholders the caller can later
 * re-hydrate with the returned `mapping`.
 *
 * Placeholders are deterministic per (type, position-in-text) so replays of
 * the redacted prompt are stable. The mapping is persisted alongside the
 * job's payload sidecar so `chorus replay` can re-hydrate when desired.
 *
 * Patterns:
 *   - email          RFC-ish (intentionally permissive on TLDs)
 *   - us_ssn         NNN-NN-NNNN
 *   - cc             credit-card-shape (13–19 digits, Luhn-validated)
 *   - github_pat     ghp_/gho_/ghs_/ghu_/ghr_… 36+ url-base64 chars
 *   - aws_key        AKIA / ASIA + 16 base32-ish chars
 *   - private_ip     10/8, 172.16/12, 192.168/16, 127/8
 *   - hostname_internal *.internal, *.local, *.corp, *.lan
 *
 * Off-by-default. Enabled via callOne({ redact: true }) or `--redact` CLI
 * flag or env `CHORUS_REDACT=1`. Per the M6.5 plan: opt-in only — Chorus
 * does not silently rewrite content.
 */

function luhnOk(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = num.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

const PATTERNS = [
  { type: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "us_ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: "cc",
    re: /\b\d{13,19}\b/g,
    validate: (m) => luhnOk(m)
  },
  { type: "github_pat", re: /\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9_]{36,}\b/g },
  { type: "aws_key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    type: "private_ip",
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g
  },
  { type: "hostname_internal", re: /\b[A-Za-z0-9-]+\.(?:internal|local|corp|lan)\b/g }
];

export function redactText(input) {
  if (typeof input !== "string" || input.length === 0) {
    return { text: input ?? "", mapping: [] };
  }
  const mapping = [];
  let text = input;
  // Apply in order; track counts per type for stable placeholder numbering.
  const counters = {};
  for (const { type, re, validate } of PATTERNS) {
    text = text.replace(re, (match) => {
      if (validate && !validate(match)) return match;
      counters[type] = (counters[type] ?? 0) + 1;
      const placeholder = `<chorus-redacted:${type}:${counters[type]}>`;
      mapping.push({ type, index: counters[type], placeholder, original: match });
      return placeholder;
    });
  }
  return { text, mapping };
}

export function rehydrate(text, mapping) {
  if (!Array.isArray(mapping) || mapping.length === 0 || !text) return text ?? "";
  let out = text;
  for (const { placeholder, original } of mapping) {
    out = out.split(placeholder).join(original);
  }
  return out;
}

export function redactionEnabled(flags = {}) {
  if (flags.redact) return true;
  if (process.env.CHORUS_REDACT === "1") return true;
  return false;
}
