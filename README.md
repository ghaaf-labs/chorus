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

## Status

v0.1 in development. M0 ships Claude Code as caller, Codex as target. See `docs/architecture.md` for the full milestone plan.

## License

Apache-2.0.
