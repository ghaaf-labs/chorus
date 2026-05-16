# Vendor capability matrix

Chorus presents one API across several target CLIs and one local retrieval
target, but the targets are not interchangeable. This page documents what each
target provides at each layer, especially over ACP, where the protocol does not
standardize many of the fields Chorus needs.

## Subprocess vs ACP, per target

| Target | Subprocess mode | ACP mode | Notes |
|---|---|---|---|
| `claude-code` | `claude -p --output-format json --json-schema <inline>` | `claude-code-acp` (community bridge; auto-detected on `$PATH`) | Subprocess is default. ACP needs `npm i -g @agentclientprotocol/claude-agent-acp` (or equivalent). |
| `codex` | `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral` | `codex-acp` (community bridge; auto-detected on `$PATH`) | Subprocess is default. ACP needs `cargo install codex-acp` (or `npm i -g codex-acp` if a JS port exists). |
| `grok` | `grok -p --output-format json --no-subagents --no-plan` | `grok agent stdio` (native ACP server) | ACP is default; warm sessions are ~2× faster than subprocess. |
| `opencode` | `opencode run --pure --format json --agent chorus-buddy --dangerously-skip-permissions` | `opencode acp --pure` (native ACP server). `--model X` plumbed via `OPENCODE_MODEL` env. | ACP is default. |
| `grok-build` | `grok build ...` | n/a | Subprocess target. |
| `copilot` | `copilot ...` | n/a | Subprocess target. |
| `knowledge` | `uv run knowledge search ... --no-telemetry` | n/a | Local retrieval peer, not an LLM. |

## Token Counting

ACP does not standardize a usage/token-count metadata channel. Most ACP-mode targets return zero tokens to Chorus today:

| Target × mode | Returns input tokens | Returns output tokens | Returns cost-grade usage |
|---|---|---|---|
| claude-code × subprocess | ✓ (from `--output-format json` usage field) | ✓ | ✓ |
| claude-code × ACP (bridge) | partial (depends on bridge) | partial | usually no |
| codex × subprocess | ✓ (from `--json` event stream usage) | ✓ | ✓ |
| codex × ACP (bridge) | partial (depends on bridge) | partial | usually no |
| grok × subprocess | ✓ | ✓ | ✓ |
| grok × ACP | ✗ | ✗ | ✗ |
| opencode × subprocess | ✓ (from `step_finish` events) | ✓ | ✓ |
| opencode × ACP | ✗ | ✗ | ✗ |

When ACP returns zero tokens, Chorus estimates from input/output byte counts at
~4 chars/token and tags the envelope with `tokens.estimated: true`. The
`cost_usd_estimate` from this path is approximate. Callers that need cost-grade
numbers should check `tokens.estimated` before relying on it.

## Cold-start latency

Measured on a single Apple Silicon laptop with local CLI installs and default
models:

| Target × mode | First call (cold) | Subsequent calls (warm pool) |
|---|---|---|
| grok × ACP | ~99s (slow boot) | ~7–10s |
| opencode × ACP | ~7–10s | ~5–8s |
| claude-code × subprocess | ~15–25s | ~15–25s (no persistent session) |
| codex × subprocess | ~10–60s (model-dependent) | ~10–60s |

The ACP pool in `core/src/runners/acp.mjs` keys connections by `target|model|cwd`. In a Chorus session that does N calls to the same target, the cold-start cost is paid once.

## Streaming and cancellation

| Capability | claude-code | codex | grok | opencode |
|---|---|---|---|---|
| `session/update` agent_message_chunk (subprocess) | n/a (one-shot JSON) | n/a (one-shot JSONL) | n/a | n/a |
| `session/update` over ACP | yes (via bridge) | yes (via bridge) | yes | yes |
| `session/cancel` honored | bridge-dependent | bridge-dependent | yes | yes |
| Process-group SIGTERM cleanup | ✓ (subprocess) | ✓ (subprocess) | ✓ (subprocess) | ✓ (subprocess) |

Chorus's `session/cancel` sends a cancel notification upstream on ACP **and**
SIGTERMs the pooled child if cancel was ignored. Process tree escalation in
`core/src/process.mjs::terminateProcessTreeWithEscalation` ensures the worker
doesn't outlive the cancel.

## Schema enforcement

| Target × mode | Server-side schema enforcement | Strategy used |
|---|---|---|
| claude-code × subprocess | strong | `--json-schema <inline>` (Anthropic enforces) |
| codex × subprocess | strong | `--output-schema <path>` (OpenAI enforces) |
| grok × subprocess | none | XML envelope contract in role markdown + Chorus client-side Ajv validation |
| opencode × subprocess | none | XML envelope contract + custom `chorus-buddy` agent + client-side Ajv validation |
| any × ACP | none | client-side Ajv validation only |

Even when the target enforces server-side, Chorus re-validates client-side via
Ajv2020 in `core/src/summarize.mjs`. Every role contributes a normalized
verdict so council consensus and judge mode can compare target outputs.

## Council fan-out caveats

- Targets with `runModes: [acp, ...]` share the same ACP pool entry within one process; concurrent council calls to the *same* target serialize on the same session.
- The Knowledge Index target wraps a local Qdrant-backed store; plan for its
  local runtime characteristics when adding `--retrieve` to council fan-outs.
