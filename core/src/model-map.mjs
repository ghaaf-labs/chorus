/**
 * Cross-vendor model name translation.
 *
 * When replaying a job from vendor A on vendor B, the `--model` carried over
 * from the original call (e.g. "gpt-5.4-mini") is meaningless on B (Grok),
 * and worse, B may silently fail or time out trying to honor it.
 *
 * MODEL_MAP[srcModel][targetVendor] = translatedModelName | undefined
 *
 * `undefined` means "no good mapping; drop the --model flag and let the
 * target pick its default." This is the safest behavior and what callers
 * should do when translateModel() returns undefined.
 */

const MODEL_MAP = {
  // Codex family
  "gpt-5.4-mini": {
    codex: "gpt-5.4-mini",
    "claude-code": "claude-haiku-4-5",
    grok: undefined,
    opencode: "opencode/gpt-5.4-mini"
  },
  "gpt-5.4": {
    codex: "gpt-5.4",
    "claude-code": "claude-opus-4",
    grok: undefined,
    opencode: "opencode/gpt-5.4"
  },
  // Claude family
  "claude-sonnet-4-7": {
    "claude-code": "claude-sonnet-4-7",
    codex: undefined,
    grok: undefined,
    opencode: "opencode/claude-sonnet-4-7"
  },
  "claude-haiku-4-5": {
    "claude-code": "claude-haiku-4-5",
    codex: "gpt-5.4-mini",
    grok: undefined,
    opencode: "opencode/claude-haiku-4-5"
  },
  "claude-opus-4-7": {
    "claude-code": "claude-opus-4-7",
    codex: "gpt-5.4",
    grok: undefined,
    opencode: "opencode/claude-opus-4-7"
  },
  // Grok family
  "grok-4": {
    grok: "grok-4",
    codex: undefined,
    "claude-code": undefined,
    opencode: undefined
  },
  "grok-4-3": {
    grok: "grok-4-3",
    codex: undefined,
    "claude-code": undefined,
    opencode: undefined
  },
  // Opencode passthrough patterns are already "provider/model"; pass them as-is
  "sonnet": {
    "claude-code": "claude-sonnet-4-7",
    opencode: "opencode/claude-sonnet-4-7",
    codex: undefined,
    grok: undefined
  }
};

/**
 * Translate `model` for `targetVendor`. Returns:
 *   - the mapped model name when an explicit mapping exists
 *   - the original model if it already matches the target's namespace
 *     (opencode-style "provider/model" strings)
 *   - undefined when the model can't be sensibly remapped (caller should
 *     drop the --model flag entirely)
 */
export function translateModel(model, targetVendor) {
  if (!model || !targetVendor) return undefined;
  // Opencode pass-through: already "provider/model" form.
  if (targetVendor === "opencode" && model.includes("/")) return model;
  // Same-vendor pass-through.
  const entry = MODEL_MAP[model];
  if (entry && Object.prototype.hasOwnProperty.call(entry, targetVendor)) {
    return entry[targetVendor];
  }
  return undefined;
}

export { MODEL_MAP };
