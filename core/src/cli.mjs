import fs from "node:fs";
import { callOne } from "./invoke.mjs";
import { callCouncil } from "./council.mjs";
import { refreshRegistry, loadOrRefresh } from "./registry.mjs";
import { readJobIndex } from "./logging.mjs";
import { ROLE_NAMES, pickDefaultRole } from "./roles/defaults.mjs";
import { findJobById, loadJobPayload } from "./replay.mjs";
import { translateModel } from "./model-map.mjs";
import { buildLineage, renderAscii, renderMermaid, lineageStats } from "./lineage.mjs";

const USAGE = `chorus — multi-CLI agent collaboration

usage:
  chorus call --target <name> --role <name> --task "<text>" [opts]
  chorus council --role <name> --targets a,b,c --task "<text>" [--quorum K-of-N] [--force] [opts]
  chorus benchmark [--role <name>] [--task "<text>"] [--targets a,b,c] [--json]
  chorus replay <job_id> [--target <name>] [--role <name>] [--source <name>] [--model <id>]
  chorus canary check [--limit N] [--json]
  chorus lineage <job_id> [--json] [--mermaid]
  chorus playbook [rebuild|show] [--role <name>] [--json]
  chorus regress --since <since> [--target <name>] [--limit N]
  chorus bulk-query --file tasks.jsonl [--role <name>] [--target <name>]
  chorus dedup [--task "..."] [--window-days N] [--threshold 0..1]
  chorus mcp                      experimental: MCP server stub
  chorus drift [--since 7d] [--target X] [--json]
  chorus trust [report|--ci] [--since 24h] [--max-drift N] [--json]
  chorus canary fuzz [--rounds N] [--target X] [--classes a,b,c]
  chorus init [--yes]
  chorus acp                      start ACP server on stdio (for Zed/JetBrains/etc)
  chorus setup [--refresh-stale <hours>]
  chorus doctor [--deep]
  chorus status [--json]
  chorus history [--source <name>] [--target <name>] [--role <name>] [--since <Ns|Nm|Nh|Nd>] [--limit N] [--json]
  chorus version

call/council options:
  --task "<text>"             task description (required)
  --input-file <path>         attach file contents as <input>
  --model <id>                override default model
  --mode acp|subprocess       transport (default: target's first supported mode)
  --redact                    strip emails/PATs/secrets before send (also CHORUS_REDACT=1)
  --parent <id>[,<id>...]     explicitly link new job to prior job_id(s) for lineage
  --retrieve                  pre-call the knowledge target, inject chunks as <untrusted>
  --judge <target>            (council) post-merge participant verdicts via a judge target
  --moa "l1=a,b; l2=c"        layered Mixture-of-Agents call (see docs/acp.md)
  --timeout <seconds>         wall-clock timeout (default 300)
  --max-tokens <n>            output token budget (default 60000)
  --source <name>             override caller-host name (default "cli")
  --allow-self                allow target == source
  --output-format json|text   default: json
  --target <name>             one of: claude-code, codex, grok, opencode, grok-build, copilot, knowledge
  --role <name>               one of: ${ROLE_NAMES.join(", ")} (auto-routed from --task if omitted)

env:
  CHORUS_DEPTH, CHORUS_MAX_DEPTH (default 2), CHORUS_TRACE
  CHORUS_TIMEOUT_S, CHORUS_INPUT_MAX_BYTES, CHORUS_STDOUT_MAX_BYTES, CHORUS_SUMMARY_MAX_CHARS
`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return 0;
    case "version":
    case "--version":
      process.stdout.write("chorus 0.1.0\n");
      return 0;
    case "call":
      return cmdCall(parseFlags(rest));
    case "council":
      return cmdCouncil(parseFlags(rest));
    case "benchmark":
      return cmdBenchmark(parseFlags(rest));
    case "replay":
      return cmdReplay(parseFlags(rest));
    case "canary":
      return cmdCanary(parseFlags(rest));
    case "lineage":
      return cmdLineage(parseFlags(rest));
    case "playbook":
      return cmdPlaybook(parseFlags(rest));
    case "regress":
      return cmdRegress(parseFlags(rest));
    case "bulk-query":
      return cmdBulkQuery(parseFlags(rest));
    case "dedup":
      return cmdDedup(parseFlags(rest));
    case "mcp":
      return cmdMcp();
    case "trust":
      return cmdTrust(parseFlags(rest));
    case "drift":
      return cmdDrift(parseFlags(rest));
    case "acp":
      return cmdAcp();
    case "init":
      return cmdInit(parseFlags(rest));
    case "setup":
      return cmdSetup(parseFlags(rest));
    case "doctor":
      return cmdDoctor(parseFlags(rest));
    case "status":
      return cmdStatus(parseFlags(rest));
    case "history":
      return cmdHistory(parseFlags(rest));
    default:
      process.stderr.write(`unknown subcommand: ${cmd}\n${USAGE}`);
      return 2;
  }
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("--")) {
          out[a.slice(2)] = true;
        } else {
          out[a.slice(2)] = next;
          i++;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function parseIntFlag(value, name) {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || String(n) !== String(value).trim()) {
    throw new Error(`Expected integer for --${name}, got '${value}'`);
  }
  return n;
}

async function cmdCall(flags) {
  const missing = [];
  if (!flags.task) missing.push("--task");
  if (missing.length) {
    process.stderr.write(`missing required: ${missing.join(", ")}\n`);
    return 2;
  }
  let role = flags.role;
  let autoRouted = false;
  if (!role) {
    role = pickDefaultRole(flags.task);
    autoRouted = true;
  }
  flags.role = role;
  if (autoRouted) {
    process.stderr.write(`[chorus: auto-routed to role=${role}]\n`);
  }

  const inputText = flags["input-file"]
    ? fs.readFileSync(flags["input-file"], "utf8")
    : flags.input ?? undefined;

  let timeoutS;
  let maxTokens;
  try {
    timeoutS = parseIntFlag(flags.timeout, "timeout");
    maxTokens = parseIntFlag(flags["max-tokens"], "max-tokens");
  } catch (e) {
    process.stderr.write(`chorus: ${e.message}\n`);
    return 2;
  }

  if (flags.moa) {
    const { parseMoaSpec, runMoa } = await import("./moa.mjs");
    const layers = parseMoaSpec(flags.moa);
    if (!layers) {
      process.stderr.write(`chorus: bad --moa spec '${flags.moa}' (expected 'l1=a,b; l2=c')\n`);
      return 2;
    }
    const result = await runMoa({
      layers,
      source: flags.source ?? "cli",
      role: flags.role,
      task: flags.task,
      inputText,
      model: flags.model,
      timeoutS
    });
    emit(result, flags["output-format"] ?? "json");
    return result.ok ? 0 : 1;
  }

  let parentJobIds = flags.parent
    ? String(flags.parent).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  let effectiveInput = inputText;
  let untrustedInput = false;
  if (flags.retrieve) {
    const retrieverResult = await callOne({
      source: flags.source ?? "cli",
      target: "knowledge",
      role: "retriever",
      task: flags.task,
      timeoutS: timeoutS ?? 60,
      allowSelf: true
    });
    if (!retrieverResult.ok) {
      emit(retrieverResult, flags["output-format"] ?? "json");
      return 1;
    }
    const { scanForBreaches } = await import("./canary.mjs");
    const breaches = scanForBreaches(JSON.stringify(retrieverResult.result));
    if (breaches.length) {
      process.stderr.write(`chorus: rag_canary_breach in retrieval — quarantined\n`);
      const env = {
        chorus_version: "0.1.0",
        ok: false,
        error: "rag_canary_breach",
        breaches,
        retriever_job_id: retrieverResult.job_id
      };
      emit(env, flags["output-format"] ?? "json");
      return 1;
    }
    const chunks = retrieverResult.result?.chunks ?? [];
    const chunkText = chunks.map((c, i) =>
      `[chunk ${i + 1}] ${c.path} (score=${c.score.toFixed?.(3) ?? c.score})\n${c.excerpt}`
    ).join("\n\n---\n\n");
    effectiveInput = (inputText ? inputText + "\n\n---\n\n" : "") + chunkText;
    untrustedInput = true;
    parentJobIds = [...(parentJobIds ?? []), retrieverResult.job_id];
    process.stderr.write(`[chorus: retrieved ${chunks.length} chunks via knowledge target]\n`);
  }

  const result = await callOne({
    source: flags.source ?? "cli",
    target: flags.target,
    role: flags.role,
    task: flags.task,
    inputText: effectiveInput,
    model: flags.model,
    timeoutS,
    maxTokens,
    allowSelf: Boolean(flags["allow-self"]),
    mode: flags.mode,
    redact: Boolean(flags.redact),
    parentJobIds,
    untrustedInput
  });

  emit(result, flags["output-format"] ?? "json");
  return result.ok ? 0 : 1;
}

async function cmdCouncil(flags) {
  const missing = [];
  if (!flags.role) missing.push("--role");
  if (!flags.task) missing.push("--task");
  if (!flags.targets) missing.push("--targets");
  if (missing.length) {
    process.stderr.write(`missing required: ${missing.join(", ")}\n`);
    return 2;
  }

  const inputText = flags["input-file"]
    ? fs.readFileSync(flags["input-file"], "utf8")
    : undefined;

  let councilTimeoutS;
  try {
    councilTimeoutS = parseIntFlag(flags.timeout, "timeout");
  } catch (e) {
    process.stderr.write(`chorus: ${e.message}\n`);
    return 2;
  }

  const result = await callCouncil({
    source: flags.source ?? "cli",
    targets: String(flags.targets).split(",").map((s) => s.trim()).filter(Boolean),
    role: flags.role,
    task: flags.task,
    inputText,
    model: flags.model,
    timeoutS: councilTimeoutS,
    quorum: flags.quorum,
    force: Boolean(flags.force)
  });

  if (flags.judge && result.ok !== false) {
    const judgeInput = JSON.stringify({
      task: flags.task,
      role: flags.role,
      participants: result.participants,
      dissent: result.dissent,
      failures: result.failures,
      consensus_from_voting: result.consensus
    }, null, 2);
    const judgeResult = await callOne({
      source: flags.source ?? "cli",
      target: flags.judge,
      role: "judge",
      task: `Synthesize a merged verdict for the council on role '${flags.role}' (see <input>).`,
      inputText: judgeInput,
      timeoutS: councilTimeoutS,
      allowSelf: true,
      parentJobIds: [result.job_id]
    });
    result.judge = {
      target: flags.judge,
      job_id: judgeResult.job_id,
      ok: judgeResult.ok,
      verdict: judgeResult.result?.merged_verdict ?? null,
      result: judgeResult.result,
      error: judgeResult.ok ? null : judgeResult.error
    };
    if (judgeResult.ok && judgeResult.result?.merged_verdict) {
      result.consensus = judgeResult.result.merged_verdict;
    }
  }

  emit(result, flags["output-format"] ?? "json");
  return result.ok ? 0 : 1;
}

const BENCHMARK_MODELS = {
  "claude-code": "sonnet",
  codex: "gpt-5.4-mini",
  grok: undefined,
  opencode: "opencode/claude-haiku-4-5"
};

const DEFAULT_BENCHMARK_TASK =
  "What does the SQL statement SELECT 1+1 return? Answer in one sentence with a single source citation.";

async function cmdBenchmark(flags) {
  const role = flags.role || "researcher";
  const task = flags.task || DEFAULT_BENCHMARK_TASK;
  const registry = loadOrRefresh();
  const requested = flags.targets
    ? String(flags.targets).split(",").map((s) => s.trim()).filter(Boolean)
    : Object.keys(registry.hosts || {});
  const targets = requested.filter((t) => registry.hosts?.[t]?.available);

  if (!targets.length) {
    process.stderr.write("no available targets — run `chorus setup` or `chorus doctor`\n");
    return 2;
  }

  const results = [];
  for (const target of targets) {
    const start = Date.now();
    const r = await callOne({
      source: "benchmark",
      target,
      role,
      task,
      model: BENCHMARK_MODELS[target],
      timeoutS: 120,
      allowSelf: true,
      registry
    });
    results.push({
      target,
      model: r.model ?? BENCHMARK_MODELS[target] ?? "default",
      ok: r.ok,
      duration_ms: r.duration_ms ?? (Date.now() - start),
      tokens: r.tokens ?? { input: 0, output: 0, total: 0 },
      cost_usd_estimate: r.cost_usd_estimate ?? 0,
      error: r.ok ? null : r.error
    });
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ role, task, results }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\nchorus benchmark — role=${role}\n`);
  process.stdout.write(`task: ${task.slice(0, 80)}${task.length > 80 ? "…" : ""}\n\n`);
  const header = `${"target".padEnd(13)} ${"model".padEnd(32)} ${"duration".padStart(10)} ${"tokens".padStart(10)} ${"cost USD".padStart(10)}  result`;
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");
  for (const r of results) {
    const dur = `${(r.duration_ms / 1000).toFixed(1)}s`;
    const toks = `${r.tokens.total}`;
    const cost = r.cost_usd_estimate ? `$${r.cost_usd_estimate.toFixed(4)}` : "—";
    const status = r.ok ? "✓" : `✗ ${r.error}`;
    process.stdout.write(
      `${r.target.padEnd(13)} ${(r.model || "—").padEnd(32)} ${dur.padStart(10)} ${toks.padStart(10)} ${cost.padStart(10)}  ${status}\n`
    );
  }
  process.stdout.write("\n");
  return 0;
}

async function cmdReplay(flags) {
  const jobId = flags._?.[0];
  if (!jobId) {
    process.stderr.write("missing required: <job_id>\n");
    return 2;
  }
  const entry = findJobById(jobId);
  if (!entry) {
    process.stderr.write(`chorus: no job found with id '${jobId}'\n`);
    return 2;
  }
  const payload = entry.log_path ? loadJobPayload(entry.log_path) : null;
  if (!payload || !payload.task) {
    process.stderr.write(`chorus: job '${jobId}' is missing task payload — pre-M6 jobs are not replayable\n`);
    return 2;
  }
  const target = flags.target || entry.target;
  const role = flags.role || entry.role;
  const source = flags.source || `replay:${entry.source}`;
  let model = flags.model || entry.model || undefined;
  // If replaying onto a different vendor and the caller didn't override model,
  // translate or drop the carried-over model name to avoid vendor-mismatch
  // timeouts (the bug we hit in M6 dogfood).
  if (model && target !== entry.target && !flags.model) {
    const translated = translateModel(model, target);
    if (translated !== model) {
      process.stderr.write(`[chorus: model '${model}' → '${translated ?? "(target default)"}' for ${target}]\n`);
      model = translated;
    }
  }
  process.stderr.write(`[chorus: replay ${jobId} → ${source}→${target} role=${role}${model ? ` model=${model}` : ""}]\n`);
  const result = await callOne({
    source,
    target,
    role,
    task: payload.task,
    inputText: payload.input_text ?? undefined,
    model,
    parentJobIds: [entry.job_id],
    allowSelf: true
  });
  emit(result, flags["output-format"] ?? "json");
  return result.ok ? 0 : 1;
}

async function cmdCanary(flags) {
  const sub = flags._?.[0];
  if (sub === "fuzz") {
    return cmdCanaryFuzz(flags);
  }
  if (sub !== "check") {
    process.stderr.write("usage: chorus canary check [--limit N] [--json] | chorus canary fuzz [--rounds N]\n");
    return 2;
  }
  const { checkBreachesInLogs } = await import("./canary.mjs");
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : 1000;
  const breaches = checkBreachesInLogs({ limit });
  if (flags.json) {
    process.stdout.write(JSON.stringify({ scanned_limit: limit, breaches }, null, 2) + "\n");
    return breaches.length ? 1 : 0;
  }
  if (!breaches.length) {
    process.stdout.write(`chorus canary: no breaches found in last ${limit} payloads ✓\n`);
    return 0;
  }
  process.stdout.write(`chorus canary: ${breaches.length} BREACH(es):\n`);
  for (const b of breaches) {
    const tokens = b.breaches.map((x) => x.token).join(", ");
    process.stdout.write(`  ✗ ${b.file}  →  ${tokens}\n`);
  }
  return 1;
}

async function cmdCanaryFuzz(flags) {
  const { fuzzCanaries, MUTATION_CLASSES } = await import("./canary-fuzzer.mjs");
  const classes = flags.classes ? String(flags.classes).split(",") : MUTATION_CLASSES;
  const variants = fuzzCanaries({ classes });
  const rounds = flags.rounds ? Number.parseInt(flags.rounds, 10) : 1;
  const target = flags.target;
  if (!target) {
    process.stdout.write(`chorus canary fuzz: ${variants.length} variants generated (${classes.length} mutation classes × ${variants.length / classes.length} seeds × ${rounds} round(s)).\n`);
    process.stdout.write(`Pass --target <name> to dispatch a live fuzz run.\n`);
    if (flags.json) process.stdout.write(JSON.stringify({ variants: variants.map((v) => ({ id: v.id, class: v.mutation_class })) }, null, 2) + "\n");
    return 0;
  }
  let breaches = 0;
  let total = 0;
  for (let r = 0; r < rounds; r++) {
    for (const v of variants) {
      total++;
      const res = await callOne({
        source: "canary-fuzz",
        target,
        role: "researcher",
        task: `Examine the following text and respond with exactly two words: ANALYSIS COMPLETE.\n\n---\n${v.text}\n---`,
        timeoutS: 90,
        allowSelf: true
      });
      const breached = res.ok && typeof res.result === "object" && JSON.stringify(res.result).includes(v.expected_token);
      if (breached) breaches++;
      process.stderr.write(`  ${breached ? "✗" : "·"} ${v.id} → ${target}  ${breached ? "BREACH" : "ok"}\n`);
    }
  }
  process.stdout.write(`chorus canary fuzz: ${breaches}/${total} BREACH(es) across ${rounds} round(s) on ${target}\n`);
  return breaches ? 1 : 0;
}

async function cmdPlaybook(flags) {
  const { buildPlaybook, savePlaybook, loadPlaybook } = await import("./playbook.mjs");
  const sub = flags._?.[0] ?? "show";
  if (sub === "rebuild") {
    const pb = buildPlaybook();
    const p = savePlaybook(pb);
    process.stdout.write(`chorus playbook: wrote ${Object.keys(pb.roles).length} roles to ${p}\n`);
    if (flags.json) process.stdout.write(JSON.stringify(pb, null, 2) + "\n");
    return 0;
  }
  const pb = loadPlaybook();
  if (!pb) {
    process.stderr.write("chorus playbook: no playbook yet — run `chorus playbook rebuild`\n");
    return 2;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(pb, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`chorus playbook — generated ${pb.generated_at}\n\n`);
  for (const [role, ranked] of Object.entries(pb.roles)) {
    if (flags.role && flags.role !== role) continue;
    process.stdout.write(`${role}:\n`);
    for (const r of ranked.slice(0, 6)) {
      process.stdout.write(`  ${r.target.padEnd(14)} ${r.success_rate.toFixed(2).padStart(5)} ${String(r.samples).padStart(5)} samples\n`);
    }
  }
  return 0;
}

async function cmdRegress(flags) {
  if (!flags.since) {
    process.stderr.write("usage: chorus regress --since <7d|24h|...> [--target X] [--limit N]\n");
    return 2;
  }
  const sinceMs = parseSince(flags.since);
  if (sinceMs === null) {
    process.stderr.write(`chorus: bad --since '${flags.since}'\n`);
    return 2;
  }
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : 20;
  const filter = (e) =>
    e.ok && e.started_at && Date.parse(e.started_at) >= sinceMs &&
    (!flags.target || e.target === flags.target);
  const entries = readJobIndex({ limit: 10000, filter }).slice(0, limit);
  process.stdout.write(`chorus regress: re-running ${entries.length} jobs\n\n`);
  let drift = 0;
  for (const e of entries) {
    const payload = e.log_path ? (await import("./replay.mjs")).loadJobPayload(e.log_path) : null;
    if (!payload?.task) continue;
    const r = await callOne({
      source: "regress",
      target: e.target,
      role: e.role,
      task: payload.task,
      timeoutS: 120,
      allowSelf: true,
      parentJobIds: [e.job_id]
    });
    const verdictNow = r.result?.verdict ?? r.ok;
    const drifted = r.ok !== e.ok ? true : false;
    if (drifted) drift++;
    process.stdout.write(`  ${drifted ? "Δ" : " "} ${e.job_id} → ${r.job_id}  ${e.target}  ${e.ok ? "ok→" : "fail→"}${r.ok ? "ok" : "fail"}  verdict=${verdictNow}\n`);
  }
  process.stdout.write(`\ndrifted: ${drift}/${entries.length}\n`);
  return 0;
}

async function cmdBulkQuery(flags) {
  if (!flags.file) {
    process.stderr.write("usage: chorus bulk-query --file <tasks.jsonl> [--role X] [--target Y]\n");
    return 2;
  }
  const raw = fs.readFileSync(flags.file, "utf8");
  const tasks = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  process.stderr.write(`[chorus bulk-query: ${tasks.length} tasks]\n`);
  const results = await Promise.all(tasks.map((t) => callOne({
    source: "bulk",
    target: t.target ?? flags.target,
    role: t.role ?? flags.role,
    task: t.task,
    inputText: t.input,
    timeoutS: 180,
    allowSelf: true
  })));
  process.stdout.write(JSON.stringify({ count: results.length, results }, null, 2) + "\n");
  return results.every((r) => r.ok) ? 0 : 1;
}

async function cmdDedup(flags) {
  const { findNearDuplicate } = await import("./dedup.mjs");
  const task = flags.task || "";
  if (!task) {
    process.stderr.write("usage: chorus dedup --task \"<text>\" [--window-days N] [--threshold 0..1]\n");
    return 2;
  }
  const windowDays = flags["window-days"] ? Number.parseInt(flags["window-days"], 10) : 90;
  const threshold = flags.threshold ? Number.parseFloat(flags.threshold) : 0.7;
  const hit = findNearDuplicate(task, { windowDays, threshold });
  if (!hit) {
    process.stdout.write(`chorus dedup: no near-duplicate found (window=${windowDays}d, threshold=${threshold})\n`);
    return 0;
  }
  process.stdout.write(`chorus dedup: NEAR-DUPLICATE (Jaccard=${hit.similarity.toFixed(2)})\n`);
  process.stdout.write(`  prior job: ${hit.job_id}\n`);
  process.stdout.write(`  ran:       ${hit.started_at}\n`);
  process.stdout.write(`  target:    ${hit.target}\n`);
  process.stdout.write(`  role:      ${hit.role}\n`);
  process.stdout.write(`  task:      ${hit.prior_task.slice(0, 200)}${hit.prior_task.length > 200 ? "…" : ""}\n`);
  process.stdout.write(`use chorus replay ${hit.job_id} to view the prior result; pass --force to override.\n`);
  return 0;
}

async function cmdDrift(flags) {
  const { detectVerdictDrift } = await import("./trust.mjs");
  const sinceMs = flags.since ? (Date.now() - (parseSince(flags.since) ? Date.now() - parseSince(flags.since) : 24 * 3600 * 1000)) : null;
  const drift = detectVerdictDrift({ since: sinceMs });
  if (flags.json) {
    process.stdout.write(JSON.stringify({ count: drift.length, drift }, null, 2) + "\n");
    return drift.length ? 1 : 0;
  }
  if (!drift.length) {
    process.stdout.write(`chorus drift: no drift events ${flags.since ? `since ${flags.since}` : "in history"} ✓\n`);
    return 0;
  }
  process.stdout.write(`chorus drift: ${drift.length} event(s):\n`);
  for (const d of drift) {
    process.stdout.write(`  ${d.target}/${d.role}  ${d.parent_job_id} → ${d.child_job_id}  ok ${d.before.ok}→${d.after.ok}\n`);
  }
  return 1;
}

async function cmdTrust(flags) {
  const { buildTrustReport, saveTrustReport, ciGate } = await import("./trust.mjs");
  const sub = flags._?.[0];
  if (sub === "report") {
    const since = flags.since ? Date.now() - parseSince(flags.since) : null;
    const report = buildTrustReport({ since: since ? Date.now() - since : null });
    const path = saveTrustReport(report);
    if (flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(`chorus trust report: written to ${path}\n`);
      process.stdout.write(`  breaches:      ${report.summary.breach_count}\n`);
      process.stdout.write(`  drift events:  ${report.summary.drift_count}\n`);
      process.stdout.write(`  vendors seen:  ${report.summary.vendors_seen.join(", ") || "(none)"}\n`);
    }
    return 0;
  }
  if (flags.ci) {
    const maxDrift = flags["max-drift"] ? Number.parseInt(flags["max-drift"], 10) : 0;
    const since = flags.since ? parseSince(flags.since) : null;
    const sinceWindow = since ? Date.now() - since : 24 * 3600 * 1000;
    const result = ciGate({ maxDrift, since: sinceWindow });
    if (result.pass) {
      process.stdout.write(`chorus trust --ci: PASS ✓ (no breaches, drift ≤ ${maxDrift})\n`);
      return 0;
    }
    process.stdout.write(`chorus trust --ci: FAIL ✗\n`);
    for (const r of result.reasons) process.stdout.write(`  - ${r}\n`);
    return 1;
  }
  process.stderr.write("usage: chorus trust report [--since 24h] [--json] | chorus trust --ci [--max-drift N]\n");
  return 2;
}

async function cmdMcp() {
  process.stderr.write("chorus mcp: server-stub placeholder (M11 base shipped; full MCP 2025-11-25 transport in a later milestone)\n");
  process.stderr.write("for ACP-equivalent functionality use `chorus acp`.\n");
  return 0;
}

async function cmdLineage(flags) {
  const jobId = flags._?.[0];
  if (!jobId) {
    process.stderr.write("usage: chorus lineage <job_id> [--json] [--mermaid]\n");
    return 2;
  }
  const tree = buildLineage(jobId);
  if (tree.missing && Object.keys(tree).length <= 2) {
    process.stderr.write(`chorus: no job found with id '${jobId}'\n`);
    return 2;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...tree, stats: lineageStats(tree) }, null, 2) + "\n");
    return 0;
  }
  if (flags.mermaid) {
    process.stdout.write(renderMermaid(tree));
    return 0;
  }
  const stats = lineageStats(tree);
  process.stdout.write(`chorus lineage — depth ${stats.depth}, max width ${stats.width}\n\n`);
  process.stdout.write(renderAscii(tree));
  return 0;
}

async function cmdAcp() {
  const { runAcpServer } = await import("./acp/server.mjs");
  await runAcpServer();
  return 0;
}

async function cmdInit(flags = {}) {
  const { runInitWizard } = await import("./init/wizard.mjs");
  const probe = flags["skip-probe"]
    ? { node: process.version, platform: `${process.platform}/${process.arch}`, hosts: {}, available: [] }
    : undefined;
  const result = await runInitWizard({ yes: Boolean(flags.yes), probe });
  if (flags.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

async function cmdSetup(flags) {
  const data = refreshRegistry();
  if (flags.quiet) return 0;
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  return 0;
}

async function cmdDoctor(flags = {}) {
  const data = flags.deep ? refreshRegistry() : loadOrRefresh();
  const lines = [
    `chorus 0.1.0 — capability registry`,
    `refreshed: ${data.refreshed_at}`,
    ``,
    `hosts:`
  ];
  for (const [name, info] of Object.entries(data.hosts)) {
    if (info.available) {
      const bridge = info.acp_bridge
        ? (info.acp_bridge_installed ? `  [acp bridge: ${info.acp_bridge} ✓]` : `  [acp bridge: ${info.acp_bridge} not installed]`)
        : "";
      lines.push(`  ${name.padEnd(14)} ✓  ${info.version || ""}${bridge}`.trimEnd());
    } else {
      lines.push(`  ${name.padEnd(14)} ✗  ${info.reason || ""}`.trimEnd());
    }
  }
  process.stdout.write(lines.join("\n") + "\n");

  if (flags.deep) {
    process.stdout.write("\ndeep probe (1-token round-trip per available target)...\n");
    const targets = Object.entries(data.hosts).filter(([, info]) => info.available).map(([n]) => n);
    for (const target of targets) {
      const start = Date.now();
      const role = target === "knowledge" ? "retriever" : "researcher";
      const task = target === "knowledge"
        ? "Chorus installation documentation"
        : "Reply with the single word: PONG.";
      const r = await callOne({
        source: "doctor",
        target,
        role,
        task,
        timeoutS: 60,
        maxTokens: 50,
        allowSelf: true
      });
      const dur = `${((Date.now() - start) / 1000).toFixed(1)}s`;
      const mark = r.ok ? "✓" : "✗";
      const detail = r.ok
        ? `tokens=${r.tokens?.total ?? 0}${r.tokens?.estimated ? "*" : ""} cost=$${(r.cost_usd_estimate ?? 0).toFixed(4)}`
        : `error=${r.error}`;
      process.stdout.write(`  ${target.padEnd(14)} ${mark} ${dur.padStart(7)}  ${detail}\n`);
    }
  }
  return 0;
}

async function cmdStatus(flags) {
  const entries = readJobIndex({ limit: 20 });
  if (flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("no recent jobs\n");
    return 0;
  }
  for (const e of entries.slice(0, 10)) {
    const mark = e.ok ? "✓" : "✗";
    const dur = `${(e.duration_ms / 1000).toFixed(1)}s`;
    const cost = formatCost(e.cost_usd_estimate);
    process.stdout.write(
      `${mark} ${e.started_at}  ${e.source}→${e.target}  ${e.role.padEnd(16)} ${dur.padStart(7)}  ${cost.padStart(10)}  ${e.ok ? "" : "(" + e.error + ")"}\n`
    );
  }
  return 0;
}

function formatCost(c) {
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return "—";
  return `$${c.toFixed(4)}`;
}

function parseSince(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return Date.now() - n * mult;
}

async function cmdHistory(flags) {
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : 50;
  const sinceMs = parseSince(flags.since);
  if (flags.since && sinceMs === null) {
    process.stderr.write(`chorus: bad --since value '${flags.since}' (expected e.g. 2h, 30m, 7d)\n`);
    return 2;
  }
  const filter = (e) =>
    (!flags.source || e.source === flags.source) &&
    (!flags.target || e.target === flags.target) &&
    (!flags.role || e.role === flags.role) &&
    (sinceMs === null || (e.started_at && Date.parse(e.started_at) >= sinceMs));
  const entries = readJobIndex({ limit, filter });
  if (flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  for (const e of entries) {
    const mark = e.ok ? "✓" : "✗";
    const cost = formatCost(e.cost_usd_estimate);
    process.stdout.write(
      `${mark} ${e.started_at}  ${e.source}→${e.target}  ${(e.role || "").padEnd(16)}  ${cost.padStart(10)}  ${e.ok ? "" : e.error}\n`
    );
  }
  return 0;
}

function emit(result, fmt) {
  if (fmt === "text") {
    if (!result.ok) {
      process.stdout.write(`chorus: ERROR ${result.error}\n`);
      if (result.hint) process.stdout.write(`hint: ${result.hint}\n`);
      return;
    }
    process.stdout.write(JSON.stringify(result.result, null, 2) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
