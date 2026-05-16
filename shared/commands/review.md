---
description: Get a code review from another CLI agent via Chorus
argument-hint: [--target <name>] [--base <ref>]
allowed-tools: Bash(chorus:*), Bash(git:*), Bash(node:*)
---

Run a Chorus review against the working tree or branch.

Raw slash-command arguments:
`$ARGUMENTS`

Behaviour:

1. Assemble the diff:
   - If `--base <ref>` was given: `git diff <ref>...HEAD > /tmp/chorus-review.diff`.
   - Else: `git diff HEAD > /tmp/chorus-review.diff` (working tree vs HEAD); if that's empty, try `git diff --cached`; if still empty, run `git status --short` and report "nothing to review".
2. Parse `--target <name>` if present.
3. Run:
   ```bash
   chorus call --source claude-code --role reviewer \
     ${TARGET:+--target $TARGET} \
     --task "Review the diff at /tmp/chorus-review.diff" \
     --input-file /tmp/chorus-review.diff
   ```
4. Return Chorus's stdout verbatim. Do not paraphrase, summarize, or address the findings yourself.
