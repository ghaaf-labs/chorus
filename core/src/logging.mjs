import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOME_DIR = path.join(os.homedir(), ".chorus");
const REPO_LOG_DIR = process.env.CHORUS_REPO_ROOT
  ? path.join(process.env.CHORUS_REPO_ROOT, ".logs")
  : null;

export function logsDir() {
  if (REPO_LOG_DIR) return REPO_LOG_DIR;
  return path.join(HOME_DIR, "logs");
}

export function jobsIndexPath() {
  return path.join(HOME_DIR, "jobs.jsonl");
}

async function ensureHomeDir() {
  await fsp.mkdir(HOME_DIR, { recursive: true });
}

export function generateJobId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
}

export function newJobLogPath({ source, target, role, jobId }) {
  fs.mkdirSync(logsDir(), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(logsDir(), `${ts}-${source}-${target}-${role}-${jobId}.jsonl`);
}

/**
 * Async, non-blocking job logger. Writes go through a streaming sink so the
 * event loop never stalls during council fan-out. Callers must `await close()`
 * before relying on logs being flushed.
 */
export class JobLogger {
  constructor(logPath) {
    this.logPath = logPath;
    this.stream = fs.createWriteStream(logPath, { flags: "a" });
    this._pending = [];
  }

  event(event, payload = {}) {
    const line = JSON.stringify({ event, ts: new Date().toISOString(), ...payload }) + "\n";
    this.stream.write(line);
  }

  async payloadFile(content) {
    const p = this.logPath.replace(/\.jsonl$/, ".payload.json");
    const task = fsp.writeFile(p, JSON.stringify(content, null, 2), { mode: 0o600 });
    this._pending.push(task);
    await task;
    return p;
  }

  async close() {
    await Promise.allSettled(this._pending);
    return new Promise((r) => this.stream.end(r));
  }
}

const DEFAULT_ROTATE_BYTES = 50 * 1024 * 1024;
const DEFAULT_ROTATE_KEEP = 10;

function rotateSizeLimit() {
  const raw = process.env.CHORUS_JOBS_ROTATE_BYTES;
  if (!raw) return DEFAULT_ROTATE_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROTATE_BYTES;
}

function rotateKeep() {
  const raw = process.env.CHORUS_JOBS_ROTATE_KEEP;
  if (!raw) return DEFAULT_ROTATE_KEEP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROTATE_KEEP;
}

export async function maybeRotateJobIndex({ sizeLimit = rotateSizeLimit(), keep = rotateKeep() } = {}) {
  const p = jobsIndexPath();
  if (!fs.existsSync(p)) return { rotated: false };
  const st = await fsp.stat(p);
  if (st.size < sizeLimit) return { rotated: false, size: st.size };
  for (let i = keep - 1; i >= 1; i--) {
    const src = `${p}.${i}`;
    const dst = `${p}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        await fsp.rename(src, dst);
      } catch { /* tolerate */ }
    }
  }
  await fsp.rename(p, `${p}.1`);
  return { rotated: true, size: st.size };
}

export async function appendJobIndex(entry) {
  await ensureHomeDir();
  await maybeRotateJobIndex();
  const line = JSON.stringify(entry) + "\n";
  await fsp.appendFile(jobsIndexPath(), line);
}

export function readJobIndex({ limit = 50, filter } = {}) {
  const p = jobsIndexPath();
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const entries = raw.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const filtered = filter ? entries.filter(filter) : entries;
  return filtered.slice(-limit).reverse();
}
