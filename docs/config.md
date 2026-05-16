# Configuration

Chorus is configured with environment variables and `~/.chorus/budget.json`.

## Runtime

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHORUS_TIMEOUT_S` | `300` | Per-call subprocess timeout |
| `CHORUS_COUNCIL_TIMEOUT_S` | `600` | Council timeout ceiling |
| `CHORUS_INPUT_MAX_BYTES` | `262144` | Input truncation budget |
| `CHORUS_STDOUT_MAX_BYTES` | `4194304` | Target stdout safety limit |
| `CHORUS_SUMMARY_MAX_CHARS` | `4000` | Max string length in returned JSON |
| `CHORUS_VALIDATOR_CACHE_LIMIT` | `64` | JSON-schema validator cache size |
| `CHORUS_MAX_TOKENS` | `60000` | Default output token budget |
| `CHORUS_MAX_PARALLEL` | `4` | Reserved parallelism budget |

## Recursion And Transport

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHORUS_DEPTH` | set by Chorus | Current nested-call depth |
| `CHORUS_MAX_DEPTH` | `2` | Max nested-call depth |
| `CHORUS_TRACE` | set by Chorus | Source-target-role chain |
| `CHORUS_FORCE_MODE` | unset | Force `acp` or `subprocess` when supported |
| `CHORUS_DISABLE_ACP` | unset | Set `1` to prefer subprocess mode |
| `CHORUS_DISABLE_BRIDGES` | unset | Set `1` to skip bridge probing |
| `CHORUS_PROBE_TIMEOUT_MS` | `5000` | Per-target capability probe timeout |

## Safety

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHORUS_REDACT` | unset | Set `1` to redact task/input before sending |
| `CHORUS_DISABLE_AGENTS_MD` | unset | Set `1` to skip repo `AGENTS.md` injection |

## Logs And Observability

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHORUS_REPO_ROOT` | unset | If set, writes job logs under `<root>/.logs` |
| `CHORUS_JOBS_ROTATE_BYTES` | `52428800` | Rotate `jobs.jsonl` after this size |
| `CHORUS_JOBS_ROTATE_KEEP` | `10` | Number of rotated job indexes to keep |
| `CHORUS_OTEL_FILE` | unset | Write local span JSONL |
| `CHORUS_OTEL_ENDPOINT` | unset | Send OTLP/HTTP JSON spans |
| `CHORUS_OTEL_AUTH` | unset | Authorization header for OTLP/HTTP |
| `CHORUS_OTEL_TIMEOUT_MS` | `3000` | OTLP/HTTP export timeout |
| `CHORUS_BUDGET_PATH` | `~/.chorus/budget.json` | Override budget config path |
| `CHORUS_SPEND_LEDGER_PATH` | `~/.chorus/daily-spend.jsonl` | Override spend ledger path |

## Knowledge Index

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHORUS_KNOWLEDGE_INDEX_PATH` | auto-detect | Path to `tools/knowledge-index` |

## Budget

`~/.chorus/budget.json`:

```json
{
  "daily_usd": 5,
  "per_call_usd": 0.5,
  "per_council_usd": 2,
  "warn_only": false
}
```

Run `chorus init --yes` to create this file with conservative defaults.
