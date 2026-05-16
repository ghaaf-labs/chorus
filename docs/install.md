# Install

Chorus requires Node.js 22.14 or newer. Use Node 24 for release work.

## Package

```bash
npm install -g @chorus/cli
chorus init --yes
chorus doctor
```

For a local tarball smoke test:

```bash
npm pack
npm install -g ./chorus-cli-0.1.0.tgz
chorus version
chorus doctor
```

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
