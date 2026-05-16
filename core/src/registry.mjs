import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectAll } from "./capability.mjs";

const REGISTRY_PATH = path.join(os.homedir(), ".chorus", "capabilities.json");

export function registryPath() {
  return REGISTRY_PATH;
}

export function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeRegistry(data) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2) + "\n");
}

export function refreshRegistry() {
  const data = {
    version: 1,
    refreshed_at: new Date().toISOString(),
    hosts: detectAll()
  };
  writeRegistry(data);
  return data;
}

export function loadOrRefresh({ maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const existing = readRegistry();
  if (!existing) return refreshRegistry();
  const refreshedAt = Date.parse(existing.refreshed_at || 0);
  if (Number.isNaN(refreshedAt) || Date.now() - refreshedAt > maxAgeMs) {
    return refreshRegistry();
  }
  return existing;
}
