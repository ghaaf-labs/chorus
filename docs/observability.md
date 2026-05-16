# Chorus observability

Chorus writes local job traces for every call. Nothing about a call is hidden on
disk, and raw target output is not leaked back to the caller's context window.

## Where things live

```
~/.chorus/
├── capabilities.json          # detected CLIs + versions + auth status (refreshed by `chorus setup`)
├── jobs.jsonl                 # global one-line-per-job index (oldest first; ~1KB/job)
└── logs/                      # detailed per-job traces
    ├── 2026-05-16T11-04-00-985Z-cli-codex-devils-advocate-mp89a.jsonl
    ├── 2026-05-16T11-04-00-985Z-cli-codex-devils-advocate-mp89a.payload.json   (chmod 600)
    └── …
```

When `CHORUS_REPO_ROOT` is set, logs go to `<repo>/.logs/` instead of
`~/.chorus/logs/`. The installed CLI does not set this variable by default.

## `jobs.jsonl`

One JSON object per line. Compact summary of every call. Suitable for grepping, `jq`-ing, or piping into a dashboard. Fields:

```json
{
  "chorus_version": "0.1.0",
  "job_id": "mp89a-…",
  "source": "claude-code",
  "target": "codex",
  "role": "reviewer",
  "model": "gpt-5.4",
  "started_at": "2026-05-16T11:04:00.985Z",
  "duration_ms": 21961,
  "tokens": { "input": 23246, "output": 687, "total": 23933 },
  "cost_usd_estimate": 0.12997,
  "schema_id": "reviewer",
  "log_path": "/Users/.../.chorus/logs/2026-…jsonl",
  "ok": true
}
```

Note: `log_path` is in the index file but **never** in the envelope returned to the caller. That's deliberate — see `docs/architecture.md` § Context-poisoning controls.

## Per-job `.jsonl` trace

Each call gets its own append-only JSONL stream of lifecycle events:

| event | when |
|---|---|
| `start` | callOne entered; lists target, role, depth, schema_id |
| `spawn` | child PID + exact command + argv |
| `kill` | issued SIGTERM (and possibly SIGKILL); reports `escalated`, `orphaned` |
| `kill_error` | the kill helper itself threw (rare) |
| `exit` | child closed; bytes consumed, duration, timeout/overflow flags, kill outcome |
| `extracted` | assistant text + tokens extracted from raw stdout |
| `validated` | schema validation passed; lists any truncated fields |
| `validation_failed` | schema violation reason (could_not_parse_json or schema_invalid) |
| `payload_saved` | path to the on-disk `.payload.json` sidecar |

## Per-job `.payload.json` sidecar

The full prompt, stdout, and stderr from the target's subprocess. Written with `chmod 600` (owner-only) and gitignored. Two reasons it exists separately:

1. **Privacy:** the index file is fine to copy to a dashboard or attach to a bug report. The payload may contain code, credentials in stack traces, or proprietary prompts — keeping it in a separate file means the leakage decision is yours.
2. **Size:** large reviews can blow past 100KB of raw stdout. Keeping that out of the JSONL keeps the trace easy to tail.

## CLI commands

```
chorus status                  # last 10 jobs, rendered table
chorus status --json           # same data as JSON

chorus history                          # last 50 jobs
chorus history --source claude-code     # filter by caller
chorus history --target codex --limit 5 # filter and cap
chorus history --role reviewer --json   # for piping into jq

chorus benchmark               # run the same task across every available CLI
chorus benchmark --role devils-advocate --task "argue against X" --json
```

`chorus benchmark` is your friend after a vendor CLI upgrade. Run it, eyeball the duration/cost columns, look for regressions. The default benchmark task is the smallest possible researcher question so the absolute numbers are dominated by per-call fixed cost — useful for tracking that floor as Chorus evolves.

## OTel

Set `CHORUS_OTEL_FILE` to write span-shaped JSONL. Set
`CHORUS_OTEL_ENDPOINT` to send OTLP/HTTP JSON to a collector. See
`docs/telemetry.md` for the zero-by-default posture and
`docs/observability-setup.md` for collector examples.

## Tailing live work

```
tail -f ~/.chorus/logs/$(ls -t ~/.chorus/logs/ | head -1)
```

…will follow the most recent job's lifecycle events as they happen. Combined with `chorus status` in another pane this gives you a live view of any council fan-out.

## Disk hygiene

Chorus doesn't currently rotate logs. After a few weeks of heavy use you may want:

```
find ~/.chorus/logs -name "*.jsonl" -mtime +30 -delete
find ~/.chorus/logs -name "*.payload.json" -mtime +30 -delete
```

Or just trim `~/.chorus/jobs.jsonl` to the last N lines.

A future milestone will add automatic rotation; for now it's manual.
