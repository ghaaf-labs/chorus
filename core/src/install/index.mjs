import * as claude from "./claude.mjs";
import * as codex from "./codex.mjs";
import * as grok from "./grok.mjs";
import * as opencode from "./opencode.mjs";

const HANDLERS = { claude, codex, grok, opencode };

export const HOSTS = Object.keys(HANDLERS);

const HOST_TO_PROBE = {
  claude: "claude-code",
  codex: "codex",
  grok: "grok",
  opencode: "opencode"
};

export function isHostAvailable(probeHosts, host) {
  const probeKey = HOST_TO_PROBE[host];
  return Boolean(probeHosts?.[probeKey]?.available);
}

export function statusAll({ home } = {}) {
  return HOSTS.map((host) => HANDLERS[host].status({ home }));
}

export function statusOne(host, { home } = {}) {
  if (!HANDLERS[host]) throw new Error(`unknown host '${host}'`);
  return HANDLERS[host].status({ home });
}

export function installAll({ home, mode = "copy", dryRun = false, force = false, hosts = HOSTS, probe, runners = {} } = {}) {
  const results = [];
  for (const host of hosts) {
    if (!HANDLERS[host]) {
      results.push({ host, status: "error", reason: "unknown_host" });
      continue;
    }
    if (probe && !isHostAvailable(probe, host)) {
      results.push({ host, status: "skipped", reason: "host_not_installed" });
      continue;
    }
    const runner = runners[host];
    results.push(HANDLERS[host].install({ home, mode, dryRun, force, ...(runner ? { runner, probe: () => true } : {}) }));
  }
  return results;
}

export function uninstallAll({ home, dryRun = false, force = false, hosts = HOSTS, runners = {} } = {}) {
  const results = [];
  for (const host of hosts) {
    if (!HANDLERS[host]) {
      results.push({ host, status: "error", reason: "unknown_host" });
      continue;
    }
    const runner = runners[host];
    results.push(HANDLERS[host].uninstall({ home, dryRun, force, ...(runner ? { runner, probe: () => true } : {}) }));
  }
  return results;
}

export function summarizeForDisplay(results) {
  return results.map((r) => {
    const tag = displayTag(r.status);
    const detail = [r.mode, r.dest, r.reason].filter(Boolean).join("  ");
    return `  ${r.host.padEnd(10)} ${tag.padEnd(20)} ${detail}`;
  }).join("\n");
}

function displayTag(status) {
  switch (status) {
    case "installed": return "✓ installed";
    case "already_installed": return "✓ already installed";
    case "uninstalled": return "✓ removed";
    case "would_install": return "↻ would install";
    case "would_uninstall": return "↻ would remove";
    case "skipped": return "— skipped";
    case "not_registered": return "✗ not registered";
    case "registered": return "✓ registered";
    case "registered_stale": return "⚠ stale";
    case "n/a": return "— n/a";
    case "error": return "✗ error";
    default: return status;
  }
}
