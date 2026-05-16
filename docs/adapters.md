# Chorus adapters

Per-host install + behaviour notes. The Claude Code, Codex, and Grok adapters share the same shape (plugin manifest + symlinks to `shared/{agents,commands,skills}` + SessionStart hook). OpenCode is a JS plugin and follows a slightly different layout.

## Claude Code (`adapters/claude/`)

**Install (local development):**

```bash
ln -sf "$(pwd)/adapters/claude" ~/.claude/plugins/chorus
```

Or use Claude's marketplace once the plugin is published there.

**What it ships:**

- `.claude-plugin/plugin.json` — manifest. Plugin name is `chorus`, so slash commands appear as `/chorus:review`, `/chorus:research`, etc.
- `agents/` (symlink) → four thin `@chorus-*` subagents.
- `commands/` (symlink) → nine slash commands (`ask`, `review`, `research`, `architect`, `devils-advocate`, `council`, `setup`, `status`, `history`).
- `skills/` (symlink) → three progressive-disclosure skills.
- `hooks/hooks.json` → `SessionStart` refreshes the capability registry if older than 24h.

**Behaviour notes:**

- The SessionStart hook is silent on success and never blocks (`|| true`). If `chorus` is not on `$PATH`, the hook is a no-op.
- The Claude target driver uses `--no-session-persistence` + `--disable-slash-commands` (not `--bare`) so that OAuth credentials are honored. The recursion guard (CHORUS_DEPTH) prevents the spawned Claude from re-entering Chorus.

## OpenAI Codex CLI (`adapters/codex/`)

**Install:**

```bash
ln -sf "$(pwd)/adapters/codex" ~/.codex/plugins/chorus
```

**Shape:** mirrors the Claude adapter — same plugin.json layout, same shared/ symlinks, same SessionStart hook (but expanded as `${CODEX_PLUGIN_ROOT}`).

**Behaviour notes:**

- Codex passes `--ephemeral` on every spawned call so the buddy run does not appear in your Codex session list.
- Codex emits the JSONL event shape `{"type":"item.completed","item":{"type":"agent_message","text":"…"}}`. The driver knows both that and the legacy `msg.agent_message.message` shape.
- `--output-schema` is passed; Codex validates the response itself before Chorus does the second pass with Ajv.

## xAI Grok CLI (`adapters/grok/`)

**Install:**

```bash
ln -sf "$(pwd)/adapters/grok" ~/.grok/plugins/chorus
```

**Behaviour notes:**

- Grok emits a single JSON object (not JSONL) when given `--output-format json`. The driver pulls `.text` from that one object.
- Per-call cold start is ~5s (Grok's networking + WebSocket setup). Council fan-out where Grok is one of N targets will be bottlenecked by Grok.
- `--no-subagents` is non-negotiable: without it, Grok will happily spawn its own internal subagents inside our isolated call.
- The devil's-advocate role uses Grok by default — its training is less agreement-by-default, which produces sharper critique.

## OpenCode (`adapters/opencode/`)

OpenCode's plugin model is different — JS modules, not markdown trees.

**Install (caller side — OpenCode as host):**

```bash
# Link the four chorus-* caller subagents into your OpenCode agent dir
ln -sf "$(pwd)/adapters/opencode/agents/chorus-reviewer.md"        ~/.config/opencode/agent/chorus-reviewer.md
ln -sf "$(pwd)/adapters/opencode/agents/chorus-researcher.md"      ~/.config/opencode/agent/chorus-researcher.md
ln -sf "$(pwd)/adapters/opencode/agents/chorus-architect.md"       ~/.config/opencode/agent/chorus-architect.md
ln -sf "$(pwd)/adapters/opencode/agents/chorus-devils-advocate.md" ~/.config/opencode/agent/chorus-devils-advocate.md
```

Then inside OpenCode: `@chorus-reviewer review my staged changes`.

**Target side (OpenCode as buddy):** no install step. The Chorus core driver auto-installs `~/.config/opencode/agent/chorus-buddy.md` on first call. That agent overrides OpenCode's default "coding agent" persona so it complies with the Chorus XML envelope's `<output_contract>` instead of refusing to emit JSON.

**Behaviour notes:**

- `--pure` is always passed when OpenCode is the target. Without it, OpenCode would re-load this plugin recursively.
- Model strings use `<provider>/<model>` shape (e.g. `opencode/claude-haiku-4-5`). This differs from the other three adapters which use bare model names.
- OpenCode's JS plugin (`adapters/opencode/src/plugin.mjs`) is currently a
  minimal scaffold. A future release can add in-process `chorus_call` and
  `chorus_council` tools that bypass the CLI wrapper for tighter latency.

## Recursion safety summary

Every adapter relies on the same protection: `CHORUS_DEPTH` env var is incremented on every spawn, and `CHORUS_MAX_DEPTH` (default 2) is enforced before any subprocess starts. Cycle detection (`CHORUS_TRACE`) refuses any edge that already appears in the call chain.

Per-target additional guards:

| Target | Extra recursion guard |
|---|---|
| Claude Code | `--no-session-persistence`, `--disable-slash-commands` |
| Codex | `--ephemeral`, `--sandbox read-only` |
| Grok | `--no-subagents`, `--no-plan`, `--no-memory` |
| OpenCode | `--pure`, `--agent chorus-buddy` (purpose-built role-only persona) |
