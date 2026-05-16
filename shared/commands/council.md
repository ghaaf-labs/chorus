---
description: Fan out the same task across multiple CLI agents and aggregate consensus + dissent
argument-hint: --role <name> --targets a,b,c "<task>"
allowed-tools: Bash(chorus:*), Bash(node:*)
---

Run a Chorus council: fan-out the same task across multiple targets in parallel, return consensus + dissent.

Raw slash-command arguments:
`$ARGUMENTS`

Behaviour:

1. Parse `--role <name>` (required) and `--targets a,b,c` (required). The rest is the task.
2. Run:
   ```bash
   chorus council --source claude-code --role <ROLE> --targets <TARGETS> --task "<TASK>"
   ```
3. Return Chorus's stdout verbatim.
