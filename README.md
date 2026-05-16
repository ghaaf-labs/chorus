# Chorus

Multi-CLI agent collaboration toolkit. Lets four CLI coding agents call each other for review, research, planning, or adversarial critique — without bloating the calling agent's context.

Targets:

- **Claude Code** (Anthropic)
- **OpenAI Codex CLI**
- **xAI Grok CLI**
- **OpenCode** (sst/opencode)

Every CLI can be both a *host* (caller) and a *target* (callee). Full 4×4 mesh.

## How it works

```
You in Claude Code              chorus-core (subprocess)         Codex (subprocess)
─────────────────────────       ────────────────────────         ────────────────────
/chorus:review my diff   ───▶   spawn codex exec --json   ───▶   reviews diff
                                receive JSON, validate                  │
                                truncate, log to disk     ◀─────────────┘
return only the schema-validated review JSON
```

Your Claude Code session grows by a few KB regardless of how much work Codex did. The full Codex transcript is written to `chorus/.logs/<job>.jsonl` on disk — never returned through the parent's context window.

## Roles

| Role | What it does | Default target |
|---|---|---|
| `reviewer` | Adversarial code review of a diff or branch | Codex |
| `researcher` | Deep research with citations | Grok (web search) |
| `architect` | Plan candidate architectures for a problem | Codex |
| `devils-advocate` | Find the strongest reasons your plan is wrong | Grok |

Default target falls back gracefully (`reviewer`: codex → grok → opencode → claude) if a CLI isn't installed or authenticated.

## Auth — your existing subscriptions work

Chorus does not manage API keys. It calls each official CLI directly, so each subprocess inherits whatever auth the user set up:

- **Claude Code** — Anthropic Pro / Max subscription via `claude login` OAuth
- **Codex** — ChatGPT Plus / Pro subscription via `codex login`
- **Grok** — SuperGrok tier via `grok` interactive login
- **OpenCode** — routes to whichever provider you've logged in with via `opencode providers login`

A Pro + Plus + SuperGrok Lite bundle (~$60/mo combined) covers the full 4×4 mesh at $0 per-call inside subscription quotas. See `docs/subscriptions.md` for the full breakdown including the 2026 Anthropic third-party ban and OpenAI–OpenCode partnership.

Chorus is not a third-party harness — it shells out to each vendor's own binary, so the third-party-OAuth ban Anthropic enforced in April 2026 does not apply.

## ACP (Agent Client Protocol)

Chorus speaks ACP in both directions:

- **As a client** — Grok and OpenCode get called over ACP natively (long-lived sessions, no per-call cold start). Claude Code and Codex stay on subprocess until you install their community ACP bridges. See `docs/acp.md`.
- **As a server** — `chorus acp` exposes Chorus itself as a single ACP agent. Install once in Zed or a JetBrains IDE and access the full 4×4 mesh through one connection. Route between targets with `@grok`, `@codex`, `@claude-code`, `@opencode` directives, or pin a role with `@reviewer`, `@architect`, `@researcher`, `@devils-advocate`.

## What's new in M6.5 (safety baseline + hotfix)

- **Prompt-firewall** — `chorus call --redact …` (or `CHORUS_REDACT=1`) strips emails, GitHub PATs, AWS keys, Luhn-valid CC numbers, US SSNs, private IPs, and `*.internal/*.local/*.corp/*.lan` hostnames before send; mapping persists in the `.payload.json` sidecar for replay rehydration. See `docs/safety.md`.
- **Counter-RAG canaries** — `chorus canary check` scans recent payloads for canary breach tokens; sets the stage for M8's auto-quarantine on RAG injection.
- **Untrusted-content sandbox** — `composePrompt({ untrusted: true })` wraps `<input>` in `<untrusted>…</untrusted>` and appends a standing instruction to the role's system block; off by default; M7+ retriever will turn it on.
- **Cross-vendor model translation** — `chorus replay <id> --target X` no longer carries a vendor-mismatched `--model` blindly (the 99 s timeout from M6 dogfood). New `core/src/model-map.mjs` translates known names; falls through to target default when no good mapping exists.
- **ACP token-count fallback** — Grok/OpenCode ACP modes used to return zero tokens; Chorus now estimates from byte counts and tags `tokens.estimated: true` so cost-firewall (M9) can enforce on ACP targets too.
- **Verdict normalized across all role schemas** — `verdict: "approve" | "needs-attention" | "inconclusive"` is now required by researcher/architect/devils-advocate/reviewer; unblocks M7 council consensus and M8 judge.
- **`parent_job_id` → `parent_job_ids: string[]`** — plural shape; replay-of-replay and council fan-out can append properly. Old jobs.jsonl entries remain readable.
- **Vendor capability matrix** — `docs/vendor-capabilities.md` documents per-target token, latency, cancel, and schema-enforcement gaps.

## What's new in M6

- **ACP bridges auto-detected** — install `claude-code-acp` or `codex-acp` on `$PATH` and the corresponding driver gets ACP added to its `runModes` (try `--mode acp`). `chorus doctor` shows bridge status per target.
- **`chorus replay <job_id>`** — re-run any past job against any target, role, or model. New envelope's `parent_job_id` links to the original. See `docs/replay.md`.
- **Cost column in `chorus history` / `chorus status`** + `--since 2h|30m|7d` filter.
- **`jobs.jsonl` rotation** at 50 MB (configurable via `CHORUS_JOBS_ROTATE_BYTES`), keeps `.1..10` by default.
- **`session/cancel` actually cancels** — Ctrl-C in Zed against `chorus acp` now propagates an abort through to the spawned subprocess or pooled ACP client.
- **Auto-role default** — `chorus call --task "review this diff"` (no `--role`) auto-routes via the `pickDefaultRole` heuristic; the breadcrumb shows on stderr.
- **OpenCode model over ACP** — `--model anthropic/claude-haiku-4-5` is propagated as `OPENCODE_MODEL` env to the ACP child.

## Status

v0.1 in development. Full 4×4 mesh live (M0 through M6.5). Native ACP transport for Grok+OpenCode (plus Claude Code + Codex via auto-detected community bridges), Chorus-as-ACP-server for Zed/JetBrains integration, `chorus replay` lineage, opt-in prompt-firewall + canaries. See `docs/architecture.md` for the milestone plan, `docs/subscriptions.md` for auth, `docs/acp.md` for ACP, `docs/replay.md` for replay, `docs/safety.md` for redaction/canaries, and `docs/vendor-capabilities.md` for the per-vendor capability matrix.

## License

Apache-2.0.
