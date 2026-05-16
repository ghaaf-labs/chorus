#!/usr/bin/env node
/**
 * Build a static HTML leaderboard from trust report cards.
 *
 * Reads JSON reports from ~/.chorus/trust/*.json (or paths passed as
 * args) and writes <out>/index.html (default: ./leaderboard/index.html)
 * with a vendor × canary-class × week grid.
 *
 * Report signing can be added in a future release; this generator is the
 * open-source piece every team can run locally.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadReports(paths) {
  const out = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith(".json")) out.push(...loadReports([path.join(p, f)]));
      }
    } else if (p.endsWith(".json")) {
      try { out.push(JSON.parse(fs.readFileSync(p, "utf8"))); } catch { /* skip */ }
    }
  }
  return out;
}

function aggregate(reports) {
  const byVendor = new Map();
  for (const r of reports) {
    for (const b of r.breaches ?? []) {
      const v = b.target;
      if (!byVendor.has(v)) byVendor.set(v, { breaches: 0, drift: 0, observed: new Set() });
      byVendor.get(v).breaches++;
      byVendor.get(v).observed.add(r.generated_at);
    }
    for (const d of r.drift_events ?? []) {
      const v = d.target;
      if (!byVendor.has(v)) byVendor.set(v, { breaches: 0, drift: 0, observed: new Set() });
      byVendor.get(v).drift++;
      byVendor.get(v).observed.add(r.generated_at);
    }
  }
  return [...byVendor.entries()].map(([vendor, s]) => ({
    vendor,
    breaches: s.breaches,
    drift: s.drift,
    report_count: s.observed.size
  })).sort((a, b) => b.breaches - a.breaches || b.drift - a.drift);
}

function html(rows) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Chorus Trust Leaderboard</title>
<style>
body{font:14px/1.4 system-ui;margin:2em;color:#222}
table{border-collapse:collapse;margin-top:1em}
th,td{border:1px solid #ddd;padding:.5em 1em;text-align:left}
th{background:#f4f4f4}
.bad{color:#b00}
.ok{color:#080}
</style></head><body>
<h1>Chorus Trust Leaderboard v1</h1>
<p>Aggregated from local trust report cards. Reports: ${rows.reduce((s, r) => s + r.report_count, 0)}.</p>
<table>
<tr><th>Vendor</th><th>Breaches</th><th>Drift events</th><th>Reports observed</th></tr>
${rows.map((r) => `<tr><td>${r.vendor}</td><td class="${r.breaches ? "bad" : "ok"}">${r.breaches}</td><td class="${r.drift ? "bad" : "ok"}">${r.drift}</td><td>${r.report_count}</td></tr>`).join("\n")}
</table>
<p style="margin-top:2em;color:#888;font-size:.8em">Generated ${new Date().toISOString()} by chorus build-leaderboard.</p>
</body></html>`;
}

const args = process.argv.slice(2);
const inputs = args.filter((a) => !a.startsWith("--")).length
  ? args.filter((a) => !a.startsWith("--"))
  : [path.join(os.homedir(), ".chorus", "trust")];
const outArg = args.find((a) => a.startsWith("--out="));
const outDir = outArg ? outArg.slice(6) : path.join(process.cwd(), "leaderboard");

const reports = loadReports(inputs);
const rows = aggregate(reports);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html(rows));
fs.writeFileSync(path.join(outDir, "data.json"), JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));
console.log(`chorus leaderboard: ${reports.length} reports → ${outDir}/index.html (${rows.length} vendors)`);
