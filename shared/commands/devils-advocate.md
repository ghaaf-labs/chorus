---
description: Ask another CLI agent (default Grok) to argue against a claim or plan via Chorus
argument-hint: [--target <name>] [--input-file <path>] <claim_or_plan>
allowed-tools: Bash(chorus:*), Bash(node:*)
---

Delegate adversarial critique to a Chorus buddy.

Raw slash-command arguments:
`$ARGUMENTS`

Behaviour:

1. Strip `--target <name>` and `--input-file <path>` if present; the rest is the claim or plan to attack.
2. Run:
   ```bash
   chorus call --source claude-code --role devils-advocate \
     ${TARGET:+--target $TARGET} \
     ${INPUT_FILE:+--input-file $INPUT_FILE} \
     --task "<CLAIM>"
   ```
3. Return Chorus's stdout verbatim. Do not soften the critique.
