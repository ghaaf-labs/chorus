import { spawnSync } from "node:child_process";
import { bridgeAvailable, CLAUDE_ACP_BRIDGE, CODEX_ACP_BRIDGE } from "./targets/bridges.mjs";

const PROBES = {
  "claude-code": {
    binary: "claude",
    versionArgs: ["--version"],
    acpBridge: CLAUDE_ACP_BRIDGE
  },
  codex: {
    binary: "codex",
    versionArgs: ["--version"],
    acpBridge: CODEX_ACP_BRIDGE
  },
  grok: {
    binary: "grok",
    versionArgs: ["--version"]
  },
  opencode: {
    binary: "opencode",
    versionArgs: ["--version"]
  },
  knowledge: {
    binary: "uv",
    versionArgs: ["--version"]
  },
  "grok-build": {
    binary: "grok",
    versionArgs: ["build", "--version"]
  },
  copilot: {
    binary: "copilot",
    versionArgs: ["--version"]
  }
};

export const TARGET_NAMES = Object.keys(PROBES);

function probeBinary(name) {
  const probe = PROBES[name];
  const res = spawnSync(probe.binary, probe.versionArgs, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 5000
  });
  if (res.error && res.error.code === "ENOENT") {
    return { available: false, reason: "not_installed" };
  }
  if (res.status !== 0 && res.error) {
    return { available: false, reason: res.error.message };
  }
  const version = (res.stdout || res.stderr || "").trim().split("\n")[0];
  const info = { available: true, version, binary: probe.binary };
  if (probe.acpBridge) {
    info.acp_bridge = probe.acpBridge;
    info.acp_bridge_installed = bridgeAvailable(probe.acpBridge);
  }
  return info;
}

export function detectAll() {
  const out = {};
  for (const name of TARGET_NAMES) {
    out[name] = probeBinary(name);
  }
  return out;
}

export function isAvailable(detected, target) {
  return Boolean(detected?.[target]?.available);
}
