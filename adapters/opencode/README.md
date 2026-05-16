# Chorus — OpenCode adapter

This directory exposes Chorus inside OpenCode.

OpenCode plugins differ from Claude Code / Codex plugins:

- **Plugins** are JS/TS npm modules registered via `opencode plugin <module>`. We ship a minimal one as a future hook surface.
- **Agents** are markdown files in `~/.config/opencode/agent/*.md` or `<project>/.opencode/agent/*.md`. We ship four `chorus-*` subagents that shell out to the `chorus` CLI.

## Install (manual)

```bash
# 1. Make sure `chorus` is on your PATH and capabilities are detected
chorus setup

# 2. Install the four chorus-* subagents into your global OpenCode agent dir
ln -sf "$(pwd)/agents/chorus-reviewer.md"        ~/.config/opencode/agent/chorus-reviewer.md
ln -sf "$(pwd)/agents/chorus-researcher.md"      ~/.config/opencode/agent/chorus-researcher.md
ln -sf "$(pwd)/agents/chorus-architect.md"       ~/.config/opencode/agent/chorus-architect.md
ln -sf "$(pwd)/agents/chorus-devils-advocate.md" ~/.config/opencode/agent/chorus-devils-advocate.md
```

## Use

Inside an OpenCode session, you can now invoke any chorus buddy:

```
@chorus-reviewer review my staged changes
@chorus-researcher how does OpenCode's plugin loader resolve npm modules?
@chorus-architect propose 3 ways to wire a long-lived runner
@chorus-devils-advocate argue against using sqlite for our job index
```

Each agent shells out to `chorus call --source opencode --role <role> ...`. The chosen buddy CLI (Codex, Grok, or Claude) runs in an isolated subprocess and returns schema-validated JSON — your OpenCode context grows by only a few KB.

## Note on the chorus-buddy agent

When OpenCode is invoked as a **target** of Chorus (i.e., another CLI calls OpenCode for review/research/etc.), the Chorus core driver auto-installs a `chorus-buddy` agent into `~/.config/opencode/agent/chorus-buddy.md` on first use. That agent's only job is to obey the Chorus XML envelope and emit role-validated JSON. It is separate from the four caller-side subagents above.
