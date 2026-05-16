import { spawnSync } from "node:child_process";

const cache = new Map();

function probe(bin) {
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 2000, stdio: "pipe" });
    if (r.error && r.error.code === "ENOENT") return false;
    return true;
  } catch {
    return false;
  }
}

export function bridgeAvailable(bin) {
  if (process.env.CHORUS_DISABLE_BRIDGES === "1") return false;
  if (cache.has(bin)) return cache.get(bin);
  const v = probe(bin);
  cache.set(bin, v);
  return v;
}

export function resetBridgeCache() {
  cache.clear();
}

export const CLAUDE_ACP_BRIDGE = "claude-code-acp";
export const CODEX_ACP_BRIDGE = "codex-acp";
