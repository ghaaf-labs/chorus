# Chorus + Agent Client Protocol (ACP)

[ACP](https://agentclientprotocol.com/) is the emerging open standard for editor↔agent communication. It is JSON-RPC 2.0 over stdio, the same shape as LSP (Language Server Protocol) but for AI coding agents. Zed shipped it August 2025; JetBrains and ~25 agents support it as of May 2026.

Chorus speaks ACP in two directions:

1. **As an ACP client** — Chorus's per-target driver can speak ACP to any agent that exposes a stdio ACP server (Grok and OpenCode natively; Claude Code and Codex via community bridges). Long-lived sessions, streaming, no per-call cold start after warmup.
2. **As an ACP server** — `chorus acp` exposes Chorus itself as a single ACP agent that internally orchestrates the four CLIs. Editors / IDEs that speak ACP can install Chorus and get the whole mesh through one connection.

## As an ACP client (transport for targets)

Each target driver declares the modes it supports:

| Target | runModes | What gets spawned in ACP mode |
|---|---|---|
| `claude-code` | `[subprocess]` → `[subprocess, acp]` if `claude-code-acp` is on `$PATH` | `claude-code-acp` |
| `codex` | `[subprocess]` → `[subprocess, acp]` if `codex-acp` is on `$PATH` | `codex-acp` |
| `grok` | `[acp, subprocess]` | `grok agent stdio` |
| `opencode` | `[acp, subprocess]` | `opencode acp --pure` (model passed via `OPENCODE_MODEL` env) |

When ACP is the first supported mode, `chorus call` prefers it. Force the transport with `--mode subprocess` / `--mode acp` or with env vars `CHORUS_FORCE_MODE`, `CHORUS_DISABLE_ACP=1`.

**The ACP runner pool** keys connections by `target | model | cwd`. The first call to a target spends one initialize + session/new (~300 ms). Subsequent calls in the same chorus process reuse the connection — only session/prompt round-trips, which is where most ACP performance wins come from.

**Process lifecycle.** SIGINT and SIGTERM drain the pool gracefully. Process exit closes whatever's still open.

### Community ACP bridges (Claude Code + Codex) — **auto-detected as of M6**

Install one or both:

- **Claude Code** — `npm i -g @agentclientprotocol/claude-agent-acp` (provides the `claude-code-acp` binary; alternatives: `acp-claude-code`).
- **Codex** — `cargo install codex-acp` (Rust) or `npm i -g codex-acp` if you find a JS port. Provides the `codex-acp` binary.

After install, Chorus auto-detects the bridge at module load (cached for the process lifetime). Verify with:

```bash
chorus doctor
# claude-code     ✓  1.0.x   [acp bridge: claude-code-acp ✓]
# codex           ✓  0.130.0 [acp bridge: codex-acp ✓]
```

Force ACP for one call:

```bash
chorus call --target claude-code --mode acp --task "..."
```

Disable bridge probing (e.g. to debug a misbehaving bridge) with `CHORUS_DISABLE_BRIDGES=1`.

## As an ACP server (Chorus inside Zed / JetBrains)

```bash
chorus acp
```

…starts an ACP server on stdio. Any client that speaks ACP can connect.

### Install in Zed

Add to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "chorus": {
      "command": "chorus",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Then in Zed's agent panel, choose "chorus" as the agent. Your messages get routed through Chorus to whichever target you target with an `@directive`.

### Install in JetBrains IDEs

JetBrains' ACP support has its own onboarding panel. Add Chorus as a custom agent with command `chorus acp`.

### Routing directives

The user prompt may start with `@<target>` and/or `@<role>` tokens:

```
@grok devils-advocate argue against using sqlite for the job index
@codex review the diff at /tmp/last.patch
@opencode @architect propose three logging strategies for council mode
review my changes                          ← auto-target via reviewer fallback chain
how does ACP's session/cancel actually work?  ← auto-role researcher
```

Token table:

| Token | Effect |
|---|---|
| `@claude-code` `@codex` `@grok` `@opencode` | force target |
| `@reviewer` `@researcher` `@architect` `@devils-advocate` | force role |
| (omitted) | role inferred via `pickDefaultRole(task)`; target via the role's `default_target_order` |

You can stack them in either order: `@grok @reviewer …` and `@reviewer @grok …` both work.

### What the editor sees

For every prompt, Chorus emits three session/update notifications and one final reply:

1. `agent_thought_chunk` — short routing trace: `chorus: routing role=reviewer target=codex`
2. `agent_message_chunk` — the role's validated JSON result, pretty-printed
3. `agent_thought_chunk` — metadata: `[codex reviewer | 21961ms | tokens=23933 | cost=$0.1300]`
4. response with `stopReason: end_turn` (or `refusal` on error)

The full subprocess transcript stays in `~/.chorus/logs/*.payload.json` — never streamed back through ACP. The editor only sees the validated summary.

## Why not just talk to Codex / Grok directly from your editor?

You can — and Zed/JetBrains support those agents individually. Chorus adds three things on top:

1. **One install, four agents.** Switch between Codex, Grok, Claude, and OpenCode with an `@directive` instead of reconfiguring your editor.
2. **Role discipline.** Reviewer / Researcher / Architect / Devil's Advocate are real roles with strict output schemas. The editor sees structured JSON, not free-form prose.
3. **Cross-mesh delegation.** Roles default to the target that's best at that role. Devils-advocate defaults to Grok because Grok's training is less agreement-by-default. Reviewer defaults to Codex. Etc. You don't have to pick.

## Transport selection cheat-sheet

```bash
chorus call --target grok --role reviewer ...          # ACP (first supported mode)
chorus call --target grok --role reviewer --mode subprocess ...
CHORUS_FORCE_MODE=acp        chorus call ...
CHORUS_DISABLE_ACP=1         chorus call ...
chorus acp                                             # server mode for editors
```

## References

- [Agent Client Protocol home](https://agentclientprotocol.com/)
- [Zed ACP overview](https://zed.dev/acp)
- [ACP method specs (initialize / session/new / session/prompt / session/update)](https://agentclientprotocol.com/protocol/initialization)
- [claude-code-acp bridge](https://github.com/agentclientprotocol/claude-agent-acp)
- [codex-acp bridge](https://github.com/cola-io/codex-acp)
