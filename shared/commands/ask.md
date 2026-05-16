---
description: Free-form delegate a request to another CLI agent via Chorus
argument-hint: <target> <role> "<task>"
allowed-tools: Bash(chorus:*), Bash(node:*)
---

Free-form Chorus delegation.

Raw slash-command arguments:
`$ARGUMENTS`

Parse the first token as the target (`claude-code`, `codex`, `grok`, `opencode`), the second token as the role (`reviewer`, `researcher`, `architect`, `devils-advocate`), and the rest as the task text. If no role token is given, omit `--role` from the command — `chorus call --auto-role` will pick a default based on task content (see `core/src/roles/defaults.mjs:pickDefaultRole`).

Run:

```bash
chorus call --source claude-code --target <TARGET> --role <ROLE> --task "<TASK>"
```

Return Chorus's stdout verbatim. Do not paraphrase. Do not infer role from task content yourself — that logic lives in core.
