# Install

Chorus requires Node.js 22.14 or newer. Use Node 24 for release work.

## Package

```bash
npm install -g @chorus/cli
chorus init --yes
chorus doctor
```

`chorus init --yes` writes `~/.chorus/budget.json` and registers Chorus as a
plugin for every host CLI it detects.

For a local tarball smoke test:

```bash
npm pack
npm install -g ./chorus-cli-0.1.0.tgz
chorus version
chorus doctor
```

## Plugin registration

`chorus init` calls `chorus install` under the hood for any host the probe
finds. The standalone command:

```bash
chorus install [--host claude|codex|grok|opencode|all] [--link] [--force]
chorus install --dry-run        # show planned writes without touching disk
chorus uninstall [--host …]     # reverse
```

Default mode is `copy`: Chorus materializes the adapter into the host's plugin
directory (symlinks dereferenced into real files). `--link` symlinks the
adapter instead — useful when developing against a checked-out Chorus repo
and you want edits to appear immediately.

Per host, `chorus install`:

| Host | What it does |
| --- | --- |
| Claude Code | Builds a marketplace at `~/.chorus/marketplaces/claude/`, then shells out to `claude plugin marketplace add` + `claude plugin install chorus@chorus --scope user`. Claude Code copies the plugin into its own cache (`~/.claude/plugins/cache/chorus/chorus/0.1.0/`) and writes the registry entry itself. |
| Codex CLI | Builds a marketplace at `~/.chorus/marketplaces/codex/`, shells out to `codex plugin marketplace add`, then writes `[plugins."chorus@chorus"] enabled = true` to `~/.codex/config.toml` so Codex enables the plugin from the marketplace (`.bak` of the config is taken before mutation). |
| Grok | Copies the adapter to `~/.grok/plugins/chorus/` (Grok dir-scans this path; there is no plugin CLI). |
| OpenCode | Copies four agent files to `~/.config/opencode/agent/chorus-*.md`. |

After installing, run `/reload-plugins` inside Claude Code (or restart the
session) so the new commands, skills, and agents become available.

`chorus doctor` reports registration state for each host. See `docs/adapters.md`
for the per-host behavioural notes and the manual fallback commands.

## Target CLIs

Chorus uses official CLI login state. Install and authenticate the targets you
want to use.

| Target | Install/Auth |
| --- | --- |
| Claude Code | Install Anthropic's `claude` CLI, then run `claude login` |
| Codex CLI | Install OpenAI Codex CLI, then run `codex login` |
| Grok | Install xAI's `grok` CLI, then complete its interactive login |
| OpenCode | Install `opencode`, then run `opencode providers login` |
| GitHub Copilot CLI | Install GitHub's `copilot` CLI and authenticate with GitHub |
| Grok Build | Install a Grok CLI version that supports `grok build` |

ACP bridges are optional:

```bash
npm install -g @agentclientprotocol/claude-agent-acp
cargo install codex-acp
```

## Knowledge Index

The `knowledge` target is local and optional. From the Ghaaf workspace:

```bash
cd tools/knowledge-index
uv sync
uv run knowledge ingest
uv run knowledge index
```

Set `CHORUS_KNOWLEDGE_INDEX_PATH` if the project is not in the default
workspace location.

## Verify

```bash
chorus setup
chorus doctor
chorus doctor --deep
chorus call --role researcher --task "Say hi in one sentence." --allow-self
```

Platform status for v0.1.0:

| Platform | Status |
| --- | --- |
| macOS | Tested locally |
| Linux | Tested in CI |
| Windows | Untested; process-tree cleanup is not part of the v0.1.0 support contract |
