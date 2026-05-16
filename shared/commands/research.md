---
description: Delegate deep research with citations to another CLI agent via Chorus
argument-hint: [--target <name>] <question>
allowed-tools: Bash(chorus:*), Bash(node:*)
---

Delegate a research question to a Chorus buddy (defaults to Grok for native web search).

Raw slash-command arguments:
`$ARGUMENTS`

Behaviour:

1. Strip `--target <name>` from the arguments if present; the rest is the question.
2. Run:
   ```bash
   chorus call --source claude-code --role researcher \
     ${TARGET:+--target $TARGET} \
     --task "<QUESTION>"
   ```
3. Return Chorus's stdout verbatim.
