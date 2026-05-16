---
name: chorus-result-handling
description: Internal guidance for presenting `chorus call` output back to the user. Don't paraphrase — render the structured fields the buddy already validated.
---

# chorus-result-handling

`chorus call` emits a JSON envelope with a `result` field whose shape is determined by the role's schema. Your job is to surface it to the user, not summarize it away.

## Default behavior

Return the JSON verbatim if the calling host can render JSON nicely (most modern Claude Code / Codex setups can).

If the user clearly wants prose ("just tell me", "summarize for me"), render the most important fields as a short bulleted list. Keep severity labels and confidence numbers — do not collapse them.

## Per-role rendering hints

### reviewer
- Lead with `verdict` and the `summary`.
- Then list findings ordered by severity (critical → low).
- For each finding: `severity: title (file:line_start-line_end)` then a one-line body.
- Trailing `next_steps[]` becomes a short numbered list.

### researcher
- Lead with the `summary`.
- For each `answer`: `[confidence] claim` followed by sources.
- List `unknowns` plainly.

### architect
- One bullet per candidate with name + summary.
- Highlight the `recommendation.candidate` and its rationale.
- List `open_questions`.

### devils-advocate
- Lead with `worst_realistic_outcome`.
- List objections by severity. For each: thesis + mechanism (no fixes).
- `falsifying_assumptions[]` as a numbered list.

## On failure

If `ok: false`, report the `error` field plainly. Don't apologize. If `hint` is present, surface it.

## Don't

- Don't add commentary that wasn't in the buddy's output ("I think the reviewer missed..."). The buddy was hired for its independent view.
- Don't quietly drop fields. If a field is long, show the truncation marker; don't pretend it isn't there.
