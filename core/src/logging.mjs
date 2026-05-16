import fs from "node:fs";
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
  fs.mkdirSync(HOME_DIR, { recursive: true });
  return path.join(HOME_DIR, "jobs.jsonl");
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

export class JobLogger {
  constructor(logPath) {
    this.logPath = logPath;
    this.stream = fs.createWriteStream(logPath, { flags: "a" });
  }

  event(event, payload = {}) {
    const line = JSON.stringify({ event, ts: new Date().toISOString(), ...payload }) + "\n";
    this.stream.write(line);
  }

  payloadFile(content) {
    const p = this.logPath.replace(/\.jsonl$/, ".payload.json");
    fs.writeFileSync(p, JSON.stringify(content, null, 2), { mode: 0o600 });
    return p;
  }

  close() {
    return new Promise((r) => this.stream.end(r));
  }
}

export function appendJobIndex(entry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(jobsIndexPath(), line);
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
