export const DEFAULTS = {
  timeout_s: Number.parseInt(process.env.CHORUS_TIMEOUT_S ?? "300", 10),
  council_timeout_s: Number.parseInt(process.env.CHORUS_COUNCIL_TIMEOUT_S ?? "600", 10),
  input_max_bytes: Number.parseInt(process.env.CHORUS_INPUT_MAX_BYTES ?? String(256 * 1024), 10),
  stdout_max_bytes: Number.parseInt(process.env.CHORUS_STDOUT_MAX_BYTES ?? String(4 * 1024 * 1024), 10),
  summary_max_chars: Number.parseInt(process.env.CHORUS_SUMMARY_MAX_CHARS ?? "4000", 10),
  max_parallel: Number.parseInt(process.env.CHORUS_MAX_PARALLEL ?? "4", 10),
  max_tokens: Number.parseInt(process.env.CHORUS_MAX_TOKENS ?? "60000", 10)
};

export function truncateInput(text, max = DEFAULTS.input_max_bytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return { text, truncated: false, original_bytes: buf.length };
  const head = buf.subarray(0, Math.floor(max * 0.7));
  const tail = buf.subarray(buf.length - Math.floor(max * 0.3));
  const marker = `\n\n[... chorus: truncated ${buf.length - head.length - tail.length} bytes ...]\n\n`;
  return {
    text: head.toString("utf8") + marker + tail.toString("utf8"),
    truncated: true,
    original_bytes: buf.length
  };
}

export function truncateString(s, max = DEFAULTS.summary_max_chars) {
  if (typeof s !== "string" || s.length <= max) return s;
  return s.slice(0, max - 24) + `... [+${s.length - max + 24} chars]`;
}

export function truncateDeep(value, max = DEFAULTS.summary_max_chars, fieldsTruncated = []) {
  if (typeof value === "string") {
    if (value.length > max) {
      fieldsTruncated.push("<string>");
      return value.slice(0, max - 24) + `... [+${value.length - max + 24} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => truncateDeep(v, max, fieldsTruncated));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = truncateDeep(v, max, fieldsTruncated);
    }
    return out;
  }
  return value;
}
