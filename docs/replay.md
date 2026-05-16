# `chorus replay`

Re-run any past job against any target. The new envelope links back to the original via `parent_job_id`, the first hop in Chorus's lineage graph (full `chorus lineage` lands in M7).

```bash
chorus replay <job_id>                       # same target, same role, same model
chorus replay <job_id> --target grok         # cross-vendor A/B
chorus replay <job_id> --role devils-advocate
chorus replay <job_id> --model gpt-5.4-mini
```

## How it works

Every Chorus call writes two files under `~/.chorus/logs/`:

- `…<jobid>.jsonl` — event log (spawn, exit, timings, kill outcomes)
- `…<jobid>.payload.json` — the original `task` and `input_text`, plus the composed prompt and the target's raw stdout/stderr

`chorus replay` looks up the entry in `~/.chorus/jobs.jsonl` (and rotated `.1..N` files), reads the payload sidecar, and invokes `callOne` with `parent_job_id` set. The new entry has its own fresh `job_id` and is appended to the index alongside the original.

## What replay is good for

| Use case | Command |
|---|---|
| **Cross-vendor sanity check** — was Claude wrong, or was the prompt bad? | `chorus replay <id> --target codex` |
| **Model A/B** — does the cheaper model still pass? | `chorus replay <id> --model claude-haiku-4-5` |
| **Role re-frame** — what would a devil's-advocate say about that architecture? | `chorus replay <id> --role devils-advocate` |
| **Regression hunt** — after upgrading a CLI, re-run yesterday's jobs to see drift | (M7's `chorus regress` extends this; today: a shell loop over `chorus history --json` IDs) |

## Constraints

- Replay needs the `.payload.json` sidecar. Pre-M6 jobs (logged before `task` was persisted) cannot be replayed — `chorus replay` will report "missing task payload".
- `--allow-self` is set implicitly; a replay from `claude-code → claude-code` is legitimate (e.g. retrying after a transient error).
- Replay sets `source = "replay:<original_source>"` so the new entry is easy to filter (`chorus history --source replay:cli`).
- Logs are stored at host scope (`~/.chorus/logs/`), not per-repo — your replay history is global.
