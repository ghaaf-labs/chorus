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

## Status

v0.1 in development. Full 4×4 mesh live (M0 through M5). Native ACP transport for Grok+OpenCode, Chorus-as-ACP-server for Zed/JetBrains integration. See `docs/architecture.md` for the milestone plan, `docs/subscriptions.md` for the auth strategy, and `docs/acp.md` for the ACP integration.

## License

Apache-2.0.
