# Chorus architecture

Chorus is a multi-CLI agent collaboration toolkit. Four CLI coding agents — Claude Code, OpenAI Codex CLI, xAI Grok CLI, OpenCode — can call each other for review, research, planning, or adversarial critique. The calling agent's context window grows by a few KB regardless of how much work the buddy did.

## The core loop

A single buddy call goes through this path:

```
caller CLI (e.g. Claude Code)
    │
    │  /chorus:review  (slash command in adapters/claude/commands/review.md)
    ▼
chorus call --target codex --role reviewer --input-file diff.patch
    │
    ▼
core/src/cli.mjs::main → cmdCall
    │   parses argv into flags
    ▼
core/src/invoke.mjs::callOne
    │
    ├─▶ recursion-guard.mjs::checkGuards       refuse if depth ≥ MAX_DEPTH or cycle
    ├─▶ registry.mjs::loadOrRefresh            fetch capability cache
    ├─▶ roles/defaults.mjs::resolveTarget      pick target, refuse self by default
    ├─▶ roles/compose.mjs::composePrompt       build <chorus_envelope>+<role>+<task>+<input>+<contract>
    ├─▶ targets/<target>.mjs::buildInvocation  return { command, args, stdin }
    ├─▶ runners/process.mjs::runSubprocess     spawn, capture, enforce caps
    ├─▶ targets/<target>.mjs::extractAssistant pull assistant text out of stdout
    ├─▶ summarize.mjs::validateAndTrim         parse + Ajv2020 validate + truncate
    ├─▶ logging.mjs::JobLogger                 JSONL + .payload.json sidecar
    │
    └─▶ return validated envelope to caller
```

## Modules

| Module | Responsibility | Notes |
|---|---|---|
| `core/src/cli.mjs` | Subcommand router + argv parser | No domain logic; just dispatch |
| `core/src/invoke.mjs` | The `callOne` orchestrator | The only module that ties drivers + runner + role + summarizer together |
| `core/src/council.mjs` | Parallel fan-out and consensus | Dedupes targets, validates quorum, links participant jobs |
| `core/src/runners/process.mjs` | Subprocess execution + caps + timeouts | One runner per `runMode` (M0: only `subprocess`) |
| `core/src/targets/driver.mjs` | The `TargetDriver` contract (JSDoc only) | Each target module conforms |
| `core/src/targets/{claude,codex}.mjs` | Per-target driver: `buildInvocation`, `extractAssistant`, `extractTokens` | Drivers never spawn |
| `core/src/roles/defaults.mjs` | Role registry, fallback orderings, frontmatter parser, `pickDefaultRole` heuristic | Single source of truth for which target gets which role |
| `core/src/roles/compose.mjs` | XML-block prompt composition | Same shape for all targets |
| `core/src/schemas/*.json` | JSON Schema for each role's output | Draft 2020-12; passed to Codex `--output-schema` |
| `core/src/summarize.mjs` | Parse + Ajv2020 validate + field truncation | Zero LLM calls in this path |
| `core/src/budget.mjs` | Defaults (`input_max_bytes`, `stdout_max_bytes`, `summary_max_chars`, …) | All env-overridable |
| `core/src/recursion-guard.mjs` | `CHORUS_DEPTH`, `CHORUS_TRACE`, cycle detection | Refuses before any spawn |
| `core/src/logging.mjs` | JSONL log writer + global jobs index | Logs live under `~/.chorus/logs/` (or `<repo>/.logs/` when run from the repo) |
| `core/src/capability.mjs` | Probe installed CLIs and their auth | `which X && X --version` |
| `core/src/registry.mjs` | Cache capability detection under `~/.chorus/capabilities.json` | Refreshed by `chorus setup`, hooks, or `loadOrRefresh` after 24h |
| `core/src/pricing.mjs` | Per-model rate table for cost estimates | Hand-maintained; estimate only |

## The error tree

`runSubprocess` returns one of:

```
{ stdout, stderr, exitCode, durationMs }                           // success
{ error: "spawn_failed",  detail }                                  // binary missing or unspawnable
{ error: "timeout",       timeout_s, durationMs }                   // exceeded --timeout
{ error: "stdout_overflow", limit_bytes, durationMs }               // CHORUS_STDOUT_MAX_BYTES exceeded
{ error: "nonzero_exit",  exit_code, stderr_excerpt, durationMs }   // target exited non-zero
```

`callOne` may additionally produce:

```
{ error: "max_depth_exceeded", depth, max_depth, trace }            // recursion guard
{ error: "cycle",              edge, trace }                        // recursion guard
{ error: "self_target",        target }                             // target == source without --allow-self
{ error: "target_unavailable", target }                             // requested target failed availability
{ error: "no_available_target", attempted }                         // role fallback chain exhausted
{ error: "target_not_implemented", target }                         // registry references a driver not wired in this build
{ error: "schema_violation", reason, validator_errors_summary, raw_excerpt }
{ error: "unsupported_mode",  detail }                              // driver doesn't support requested runMode
```

Every error envelope carries a `hint` field. The `validator_errors_summary` is `{count, first}`, never the full Ajv array.

## Context-poisoning controls

The 9 mandatory controls are implemented as follows:

| # | Control | Where | How |
|---|---|---|---|
| 1 | Subprocess isolation | `runners/process.mjs` | Every call → fresh PID. `detached: true` on POSIX so we can kill the process group. |
| 2 | Summary-only return | `invoke.mjs` | Returned envelope contains `result` (validated JSON), `tokens`, `cost`, `trace_depth`. Raw stdout/stderr live in `~/.chorus/logs/*.payload.json` only — never in the returned envelope. The envelope omits both `log_path` and absolute `schema` paths. |
| 3 | Progressive disclosure | `shared/skills/*/SKILL.md` | Each skill: `name` + one-line `description` in frontmatter; full body loads on invocation. |
| 4 | Input size cap | `budget.mjs::truncateInput` (256 KB default) | Applied in `compose.mjs` before the prompt is built. |
| 5 | Stdout cap | `runners/process.mjs` (4 MB default) | Cross-threshold sets `overflowed`, terminates the process tree, short-circuits subsequent `data` chunks. |
| 6 | Output field truncation | `summarize.mjs::truncateDeep` (4000 chars/field default) | Applied after Ajv validation, before return. |
| 7 | Wall-clock timeout | `runners/process.mjs` (300 s default) | `setTimeout` + `terminateProcessTree`. |
| 8 | Recursion guard | `recursion-guard.mjs` | Reads `CHORUS_DEPTH` / `CHORUS_TRACE` from env, child env inherits incremented values. Cycle detection by `source→target:role` edge. |
| 9 | No LLM summarizer | `summarize.mjs` | Pure parse + Ajv2020 validate + field truncation. Zero model calls. |

## Extending Chorus

### Adding a new target (e.g. Grok in M3)

1. Create `core/src/targets/grok.mjs` exporting the `TargetDriver` shape: `id`, `runModes`, `buildInvocation(args)`, `extractAssistant(runResult, mode)`, `extractTokens(runResult, mode)`.
2. Register it in `core/src/invoke.mjs::DRIVERS`.
3. Add it to `core/src/capability.mjs::PROBES` and `roles/defaults.mjs::ROLE_FALLBACKS` orderings.
4. No changes needed in `runners/process.mjs` if the target still spawns a subprocess. A future long-lived-server runner would be a new file under `core/src/runners/`.

### Adding a new role

1. Create `roles/<name>.md` with frontmatter (`name`, `schema`, `default_target_order`, `required_context`) + system prompt.
2. Create `core/src/schemas/<name>.schema.json` (draft 2020-12).
3. Add the role to `ROLE_FALLBACKS` in `roles/defaults.mjs`.
4. Optionally: a shared subagent (`shared/agents/chorus-<name>.md`) and a slash command (`shared/commands/<name>.md`) to expose it natively in each host.

### Adding a new host adapter (e.g. Codex CLI as caller in M1)

1. Create `adapters/<host>/.<host>-plugin/plugin.json`.
2. Symlink `agents/`, `commands/`, `skills/` to `../../shared/{agents,commands,skills}`.
3. Add `adapters/<host>/hooks/hooks.json` with a `SessionStart` hook that calls `chorus setup --quiet --refresh-stale 24h` so the registry stays fresh.

## Why subprocess, not in-process

Chorus could, in principle, import target SDKs in-process. It deliberately does not. Subprocess isolation gives us:

- A hard kill switch (`terminateProcessTree`) when something runs away.
- Per-call environment scoping (`CHORUS_DEPTH`, `CHORUS_TRACE`) without globals.
- Resource accounting via the OS (RSS, CPU, wall-clock).
- No risk of the buddy's runtime leaking objects into the parent's heap.

The price is per-call cold-start latency, ~200 ms-2 s depending on the CLI.
Drivers that support ACP can opt into long-lived sessions.

## Stability

| Surface | Stability | Notes |
| --- | --- | --- |
| `call` | Stable | Core envelope shape is stable for v0.1.x |
| `council` | Stable | Quorum and participant fields are stable |
| `setup`, `doctor`, `status`, `history`, `version` | Stable | Intended for scripts |
| `replay`, `lineage` | Stable | Reads old `parent_job_id` and current `parent_job_ids` |
| `canary check`, `trust report` | Stable | Trust report schema may add fields only |
| `acp` | Stable | ACP server surface is intended for host integrations |
| `playbook`, `dedup`, `regress`, `bulk-query` | Experimental | Output shape can change before v0.2 |
| `drift`, `trust --ci`, `canary fuzz` | Experimental | Useful in CI, but thresholds may change |
| `mcp` | Experimental | Current implementation is a stub |
| `init` | Stable | May add prompts, but keeps `--yes` behavior |

`jobs.jsonl` entries are append-only for v0.1.x. Future schema changes must
keep old entries readable or ship a migration command.
