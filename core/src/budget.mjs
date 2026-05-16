export const DEFAULTS = {
  timeout_s: Number.parseInt(process.env.CHORUS_TIMEOUT_S ?? "300", 10),
  council_timeout_s: Number.parseInt(process.env.CHORUS_COUNCIL_TIMEOUT_S ?? "600", 10),
  input_max_bytes: Number.parseInt(process.env.CHORUS_INPUT_MAX_BYTES ?? String(256 * 1024), 10),
  stdout_max_bytes: Number.parseInt(process.env.CHORUS_STDOUT_MAX_BYTES ?? String(4 * 1024 * 1024), 10),
  summary_max_chars: Number.parseInt(process.env.CHORUS_SUMMARY_MAX_CHARS ?? "4000", 10),
  max_parallel: Number.parseInt(process.env.CHORUS_MAX_PARALLEL ?? "4", 10),
  max_tokens: Number.parseInt(process.env.CHORUS_MAX_TOKENS ?? "60000", 10)
};

/**
 * Smart, structural-aware input truncation.
 *
 * v0.1: preserve unified-diff hunks intact ("---/+++ a/foo\n@@ ..." blocks)
 * and markdown H1/H2 headers; scissor middle bodies. Falls back to the
 * legacy 70/30 head+tail split if the text has no structural markers.
 */
export function truncateInput(text, max = DEFAULTS.input_max_bytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return { text, truncated: false, original_bytes: buf.length };

  // Try structural split for diffs (very common case).
  const diffHunks = splitDiffHunks(text);
  if (diffHunks && diffHunks.length > 1) {
    const compact = compactStructural(diffHunks, max, "diff hunk");
    if (compact) {
      return { text: compact, truncated: true, original_bytes: buf.length };
    }
  }

  // Try structural split for markdown by H1/H2 headers.
  const mdSections = splitMarkdownSections(text);
  if (mdSections && mdSections.length > 1) {
    const compact = compactStructural(mdSections, max, "markdown section");
    if (compact) {
      return { text: compact, truncated: true, original_bytes: buf.length };
    }
  }

  // Fallback: legacy head/tail 70/30 split.
  const head = buf.subarray(0, Math.floor(max * 0.7));
  const tail = buf.subarray(buf.length - Math.floor(max * 0.3));
  const marker = `\n\n[... chorus: truncated ${buf.length - head.length - tail.length} bytes ...]\n\n`;
  return {
    text: head.toString("utf8") + marker + tail.toString("utf8"),
    truncated: true,
    original_bytes: buf.length
  };
}

function splitDiffHunks(text) {
  if (!/^---\s+/m.test(text) || !/\+\+\+\s+/m.test(text)) return null;
  // Split before each "diff --git" or "--- a/" file header.
  const parts = text.split(/(?=^diff --git |^--- [ab]\/)/m);
  if (parts.length <= 1) return null;
  return parts.filter((p) => p.trim());
}

function splitMarkdownSections(text) {
  const parts = text.split(/(?=^#{1,2}\s+)/m);
  if (parts.length <= 1) return null;
  return parts.filter((p) => p.trim());
}

function compactStructural(parts, max, label) {
  // Keep parts in order until we exceed the budget; drop middle parts when
  // we can't fit them, but always retain the first and last.
  const sizes = parts.map((p) => Buffer.byteLength(p, "utf8"));
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= max) return parts.join("");
  if (parts.length === 1) return null;
  const kept = [];
  const droppedIdx = [];
  let used = 0;
  // Always keep first and last.
  const reserved = sizes[0] + sizes[sizes.length - 1];
  used = reserved;
  kept[0] = parts[0];
  kept[parts.length - 1] = parts[parts.length - 1];
  for (let i = 1; i < parts.length - 1; i++) {
    if (used + sizes[i] <= max - 200) {
      kept[i] = parts[i];
      used += sizes[i];
    } else {
      droppedIdx.push(i);
    }
  }
  if (!droppedIdx.length) return null;
  const marker = `\n\n[... chorus: truncated ${droppedIdx.length} ${label}(s); kept ${parts.length - droppedIdx.length} of ${parts.length} ...]\n\n`;
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (kept[i] !== undefined) out.push(kept[i]);
    else if (droppedIdx.length && droppedIdx[0] === i) out.push(marker);
    // Subsequent dropped indices don't re-emit the marker.
  }
  return out.join("");
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
