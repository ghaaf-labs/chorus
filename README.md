# Chorus

Chorus is a multi-CLI agent collaboration toolkit. It lets Claude Code, OpenAI
Codex CLI, xAI Grok CLI, OpenCode, Grok Build, GitHub Copilot CLI, and a local
Knowledge Index target call each other for review, research, planning, and
adversarial critique without stuffing the caller's context window.

Use Chorus when you want a second agent to review a diff, a small council to
compare designs, a retrieval peer to ground an answer in local workspace docs,
or a trust report that tells you whether your agent mesh is still behaving.

## Install

```bash
npm install -g @chorus/cli
chorus init --yes
chorus doctor
```

`chorus init --yes` writes `~/.chorus/budget.json` and registers Chorus as a
plugin for every host CLI it detects (Claude Code, Codex CLI, Grok, OpenCode).
After this, `/chorus:*` slash commands, `chorus-*` agents, and Chorus skills
appear inside each host on its next restart.

For direct control over plugin registration:

```bash
chorus install --host all          # copy adapters into each host's plugin dir
chorus install --host claude       # one host only
chorus install --link              # dev mode: symlink instead of copy
chorus uninstall --host all        # reverse
chorus doctor                      # shows per-host registration status
```

Requirements: Node.js 22.14 or newer. macOS is tested locally, Linux is tested
in CI, and Windows is not a supported v0.1.0 platform.

## Quickstart

```bash
chorus setup
chorus doctor
chorus call --role researcher --task "Say hi in one sentence." --allow-self
chorus trust report
```

Chorus shells out to official CLIs and uses their existing login state. It does
not manage API keys.

## Common Workflows

```bash
# Ask one target for structured review.
chorus call --role reviewer --target codex --task "Review this patch" --input-file changes.patch

# Compare several targets and require agreement.
chorus council --role architect --targets codex,grok,opencode --task "Choose a release design" --quorum 2-of-3

# Re-run an old job against another target.
chorus replay <job_id> --target claude-code

# Inspect safety history.
chorus canary check
chorus trust --ci
```

## Targets

| Target | Notes |
| --- | --- |
| `claude-code` | Claude Code subprocess; ACP when `claude-code-acp` bridge is installed |
| `codex` | OpenAI Codex CLI subprocess; ACP when `codex-acp` bridge is installed |
| `grok` | xAI Grok CLI, ACP preferred when available |
| `opencode` | OpenCode CLI, ACP preferred when available |
| `grok-build` | Grok Build target |
| `copilot` | GitHub Copilot CLI target |
| `knowledge` | Local Ghaaf Knowledge Index retrieval peer |

## Roles

| Role | Default target order |
| --- | --- |
| `reviewer` | codex, grok-build, grok, copilot, opencode, claude-code |
| `researcher` | grok-build, grok, codex, opencode, claude-code |
| `architect` | codex, claude-code, opencode, grok-build, grok |
| `devils-advocate` | grok-build, grok, codex, claude-code, opencode |
| `retriever` | knowledge |
| `judge` | claude-code, codex, grok-build, grok, opencode |
| `refactor-scribe` | copilot, codex, claude-code, opencode |
| `test-writer` | codex, claude-code, copilot, grok-build, opencode |
| `bisector` | codex, claude-code, grok-build, opencode |
| `profiler` | codex, claude-code, grok-build, opencode |

## Safety And Trust

Chorus has opt-in redaction (`--redact` or `CHORUS_REDACT=1`), untrusted input
wrapping for retrieval, RAG canary checks, a cost firewall, lineage tracking,
and Trust v1 commands:

```bash
chorus canary check
chorus canary fuzz --rounds 1
chorus drift --since 7d
chorus trust report
chorus trust --ci
```

Telemetry is zero by default. Spans are written only when `CHORUS_OTEL_FILE` or
`CHORUS_OTEL_ENDPOINT` is set.

Chorus stores local job metadata under `~/.chorus/`. Raw prompts and target
stdout stay in local payload sidecars for replay and debugging; returned
envelopes contain only the validated summary fields.

## Docs

- `docs/install.md` — first install and target authentication
- `docs/config.md` — environment variables and budget file
- `docs/troubleshooting.md` — error codes and fixes
- `docs/safety.md` — redaction, canaries, and untrusted content
- `docs/vendor-capabilities.md` — per-target capability matrix
- `docs/observability-setup.md` — OTel exporters
- `docs/distribution.md` — npm, Homebrew, Scoop, and installer channels
- `docs/release.md` — publish checklist and npm Trusted Publishing setup

## Development

```bash
npm ci
npm run lint
npm test
npm run eval:check
npm pack --dry-run
```

Before publishing, follow `docs/release.md`. The tag-based release workflow
publishes with npm provenance and attaches a CycloneDX SBOM to the GitHub
Release.

## License

MIT.
