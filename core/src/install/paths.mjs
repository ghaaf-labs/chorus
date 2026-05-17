import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function chorusRoot() {
  const candidate = path.resolve(here, "..", "..", "..");
  if (fs.existsSync(path.join(candidate, "adapters")) && fs.existsSync(path.join(candidate, "package.json"))) {
    return candidate;
  }
  throw new Error(`chorus install: cannot locate chorus root from ${here}`);
}

export function adapterSource(host) {
  const map = { claude: "claude", codex: "codex", grok: "grok", opencode: "opencode" };
  if (!map[host]) throw new Error(`chorus install: unknown host '${host}'`);
  return path.join(chorusRoot(), "adapters", map[host]);
}

export function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(chorusRoot(), "package.json"), "utf8"));
  return pkg.version;
}

export function resolveHome(override) {
  return override || process.env.HOME || process.env.USERPROFILE;
}
