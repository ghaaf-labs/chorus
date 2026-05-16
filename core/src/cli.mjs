import fs from "node:fs";
import { callOne } from "./invoke.mjs";
import { callCouncil } from "./council.mjs";
import { refreshRegistry, readRegistry, loadOrRefresh } from "./registry.mjs";
import { readJobIndex } from "./logging.mjs";
import { ROLE_NAMES, pickDefaultRole } from "./roles/defaults.mjs";

const USAGE = `chorus — multi-CLI agent collaboration

usage:
  chorus call --target <name> --role <name> --task "<text>" [opts]
  chorus council --role <name> --targets a,b,c --task "<text>" [opts]
  chorus benchmark [--role <name>] [--task "<text>"] [--targets a,b,c] [--json]
  chorus setup [--refresh-stale <hours>]
  chorus doctor
  chorus status [--json]
  chorus history [--source <name>] [--target <name>] [--role <name>] [--limit N] [--json]
  chorus version

call/council options:
  --task "<text>"             task description (required)
  --input-file <path>         attach file contents as <input>
  --model <id>                override default model
  --timeout <seconds>         wall-clock timeout (default 300)
  --max-tokens <n>            output token budget (default 60000)
  --source <name>             override caller-host name (default "cli")
  --allow-self                allow target == source
  --output-format json|text   default: json
  --target <name>             one of: claude-code, codex, grok, opencode
  --role <name>               one of: ${ROLE_NAMES.join(", ")}

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
  const role = flags.role || (flags["auto-role"] ? pickDefaultRole(flags.task) : null);
  if (!role) {
    process.stderr.write(`missing required: --role (or pass --auto-role)\n`);
    return 2;
  }
  flags.role = role;

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

  const result = await callOne({
    source: flags.source ?? "cli",
    target: flags.target,
    role: flags.role,
    task: flags.task,
    inputText,
    model: flags.model,
    timeoutS,
    maxTokens,
    allowSelf: Boolean(flags["allow-self"])
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
    timeoutS: councilTimeoutS
  });

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

async function cmdSetup(flags) {
  const data = refreshRegistry();
  if (flags.quiet) return 0;
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  return 0;
}

async function cmdDoctor() {
  const data = loadOrRefresh();
  const lines = [
    `chorus 0.1.0 — capability registry`,
    `refreshed: ${data.refreshed_at}`,
    ``,
    `hosts:`
  ];
  for (const [name, info] of Object.entries(data.hosts)) {
    if (info.available) {
      lines.push(`  ${name.padEnd(14)} ✓  ${info.version || ""}`.trimEnd());
    } else {
      lines.push(`  ${name.padEnd(14)} ✗  ${info.reason || ""}`.trimEnd());
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
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
    process.stdout.write(
      `${mark} ${e.started_at}  ${e.source}→${e.target}  ${e.role.padEnd(16)} ${dur.padStart(7)}  ${e.ok ? "" : "(" + e.error + ")"}\n`
    );
  }
  return 0;
}

async function cmdHistory(flags) {
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : 50;
  const filter = (e) =>
    (!flags.source || e.source === flags.source) &&
    (!flags.target || e.target === flags.target) &&
    (!flags.role || e.role === flags.role);
  const entries = readJobIndex({ limit, filter });
  if (flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  for (const e of entries) {
    const mark = e.ok ? "✓" : "✗";
    process.stdout.write(
      `${mark} ${e.started_at}  ${e.source}→${e.target}  ${e.role}  ${e.ok ? "" : e.error}\n`
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
