# AGENTS.md — Chorus

Guidance for AI coding agents (Claude Code, Codex, etc.) working on Chorus itself.

## Repo shape

Standalone repo, nested inside the ghaaf workspace. Layout:

- `core/` — the shared Node.js dispatcher. Single source of truth for invoking any target CLI.
- `roles/` — canonical role system prompts (one markdown file per role).
- `shared/` — host-neutral agents, commands, skills. Symlinked into each adapter.
- `adapters/{claude,codex,grok,opencode}/` — per-host plugin packages.
- `scripts/` — build/maintenance scripts (`sync-shared.mjs`, `postpack.mjs`).
- `tests/`, `docs/`.

Edit role prompts in `roles/`, not in adapters. Adapters use filesystem symlinks for `shared/*`. The `postpack.mjs` script replaces symlinks with file copies at npm-publish time.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- Node 20+, ESM only (`type: module`). No CommonJS.
- No comments unless the *why* is non-obvious. Identifier names carry the *what*.
- All target invocations go through `core/src/invoke.mjs`. Never spawn a CLI directly from a target adapter — the adapter only builds argv + stdin envelope.
- Schema-validate every result. Truncate string fields > `CHORUS_SUMMARY_MAX_CHARS`. Never return raw subprocess stdout to a caller.

## When in doubt

Read these in order:

1. `~/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs` — the dispatcher pattern.
2. `~/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/lib/process.mjs` — `terminateProcessTree` (we reuse this verbatim).
3. `docs/architecture.md` — Chorus's own design doc.

## Don't

- Don't add LLM summarization in the core path. The role's `<output_contract>` instructs targets to emit only JSON. Summarizer is parse + validate + truncate — zero extra model calls.
- Don't return subprocess stderr/stdout to callers. Only the validated `result` object.
- Don't silently fall back to self when a target is unavailable. Return `error: "no_available_target"`.
- Don't write secrets to `.logs/`. Use the `.payload.json` side-channel with `chmod 600`.
