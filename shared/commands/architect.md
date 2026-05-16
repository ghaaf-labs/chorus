---
description: Ask another CLI agent (default Codex) to propose candidate architectures via Chorus
argument-hint: [--target <name>] [--input-file <path>] <problem>
allowed-tools: Bash(chorus:*), Bash(node:*)
---

Delegate an architecture/design question to a Chorus buddy.

Raw slash-command arguments:
`$ARGUMENTS`

Behaviour:

1. Strip `--target <name>` and `--input-file <path>` if present; the rest is the problem statement.
2. Run:
   ```bash
   chorus call --source claude-code --role architect \
     ${TARGET:+--target $TARGET} \
     ${INPUT_FILE:+--input-file $INPUT_FILE} \
     --task "<PROBLEM>"
   ```
3. Return Chorus's stdout verbatim.
