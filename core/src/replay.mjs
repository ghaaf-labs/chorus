import fs from "node:fs";
import { jobsIndexPath } from "./logging.mjs";

function jobIndexFiles() {
  const main = jobsIndexPath();
  if (!fs.existsSync(main)) return [];
  const files = [main];
  for (let i = 1; i <= 32; i++) {
    const rot = `${main}.${i}`;
    if (fs.existsSync(rot)) files.push(rot);
    else break;
  }
  return files;
}

export function findJobById(jobId) {
  for (const file of jobIndexFiles()) {
    const raw = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (let i = raw.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(raw[i]);
        if (e.job_id === jobId) return e;
      } catch { /* skip */ }
    }
  }
  return null;
}

export function loadJobPayload(logPath) {
  const p = logPath.replace(/\.jsonl$/, ".payload.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
