---
name: chorus-prompting
description: Internal guidance for shaping the `--task` text passed to `chorus call`. Use only to tighten the user's request before forwarding; never to do independent work.
---

# chorus-prompting

When forwarding a user's request via `chorus call --task "..."`, the task text is what the buddy CLI will read. Tight task text gets tight results.

## Rewriting rules

1. **Keep the user's intent verbatim.** Do not paraphrase the *what* — only the framing.
2. **Strip routing flags** the user typed (e.g. `--background`, `--wait`, model names). They belong on the `chorus call` command line, not in the task text.
3. **Name the artifact under review.** If the user said "look at this", and there's a diff at `/tmp/diff.patch`, write the task as "Review the diff at /tmp/diff.patch for ...".
4. **State the success criterion when it's not obvious.** Reviewer already has one; researcher does not — make the question crisp.
5. **Do not include solutions, hints, or your own analysis** in the task text. The buddy must answer with fresh eyes.

## Worked examples

User says:
> "can you have codex check my changes for any security issues"

Forwarded `--task`:
> "Review the diff for security vulnerabilities. Focus on auth, input validation, secrets handling, and injection vectors. Skip stylistic findings."

User says:
> "research how grok's headless mode handles json output"

Forwarded `--task`:
> "Document how the xAI grok CLI's --headless mode emits JSON: schema, event types, stdout vs stderr separation, and what events indicate completion. Cite official docs or the source repo."

## When to leave it alone

If the user already wrote a tight, specific request, pass it through. Don't rewrite for the sake of rewriting.
