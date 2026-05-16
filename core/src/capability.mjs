import { spawnSync } from "node:child_process";

const PROBES = {
  "claude-code": {
    binary: "claude",
    versionArgs: ["--version"]
  },
  codex: {
    binary: "codex",
    versionArgs: ["--version"]
  },
  grok: {
    binary: "grok",
    versionArgs: ["--version"]
  },
  opencode: {
    binary: "opencode",
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
  return { available: true, version, binary: probe.binary };
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
