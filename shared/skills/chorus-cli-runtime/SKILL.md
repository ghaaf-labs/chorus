---
name: chorus-cli-runtime
description: Internal helper contract for invoking the `chorus` CLI to delegate work to another agent (Codex, Grok, OpenCode, Claude) from inside the current host
---

# chorus-cli-runtime

This skill defines how to invoke the `chorus` CLI from a Bash tool call so that work delegated to another agent does not poison the current agent's context.

## When this skill is used

When you are inside a host (Claude Code, Codex, Grok, OpenCode) and need a different CLI agent to do something — review a diff, do deep research, propose architecture, argue against a plan — invoke `chorus call`. Chorus runs the other CLI in a subprocess, validates its output against a JSON schema, and returns only the validated result.

## Invocation contract

```
chorus call --role <reviewer|researcher|architect|devils-advocate> \
            --source <claude-code|codex|grok|opencode|cli> \
            --task "<the request, rewritten as a clear instruction>" \
            [--target <name>] \
            [--input-file <path>] \
            [--model <id>] \
            [--timeout <seconds>] \
            [--output-format json|text]
```

Defaults:
- `--source` is `cli` if you omit it. Host adapters pass their own host name.
- `--target` is auto-resolved from the role's `default_target_order`. Pass it only when the user explicitly named the target.
- `--output-format` is `json`. Use `text` only if the calling host prefers a flat string.

## Output shape

`chorus call` always emits one JSON object:

```json
{
  "ok": true,
  "job_id": "...",
  "source": "claude-code",
  "target": "codex",
  "role": "reviewer",
  "model": "gpt-5.4",
  "duration_ms": 18420,
  "tokens": { "input": 4112, "output": 980, "total": 5092 },
  "cost_usd_estimate": 0.0231,
  "result": { /* role-specific, schema-valid */ },
  "log_path": ".logs/...",
  "warnings": []
}
```

On failure:

```json
{
  "ok": false,
  "error": "timeout" | "schema_violation" | "no_available_target" | "max_depth_exceeded" | "cycle" | "spawn_failed" | "stdout_overflow" | "nonzero_exit" | "target_unavailable" | "self_target" | "target_not_implemented",
  ...
}
```

## Don't

- Don't call `chorus call --target <self>`. Use `--allow-self` only when the user explicitly asked for self-call.
- Don't pipe the buddy's intermediate output through your context. The `log_path` field points to a JSONL file on disk — read it directly with another tool only when the user asks for transcript diagnostics.
- Don't recurse: Chorus refuses calls past `CHORUS_MAX_DEPTH` (default 2) and refuses cycles.

## Setup

If `chorus call` fails with `target_unavailable` or `no_available_target`, the user should run `chorus setup` (or `/chorus:setup` from a host adapter) to refresh capability detection.
