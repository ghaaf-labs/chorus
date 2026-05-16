# Chorus authentication

Chorus does not manage API keys directly. It shells out to host CLIs that are already authenticated through their own login flows. This is intentional: each vendor has its own auth model (OAuth, ChatGPT login, subscription, provider-routed API keys) and Chorus respects whatever you already use.

**If you're trying to figure out the cheapest subscription stack to run Chorus on, read `docs/subscriptions.md` first.** That page covers the 2026 vendor landscape (Anthropic third-party ban, OpenAI–OpenCode partnership, SuperGrok tiers) and recommends the per-tier configuration that maximizes coverage at lowest cost.

Run `chorus doctor` at any time to see which targets are installed and authenticated.

## Claude Code

- **Auth model:** OAuth via `claude login` (Anthropic Pro / Max subscription) or `ANTHROPIC_API_KEY` env var.
- **Where credentials live:** macOS keychain (OAuth) or env (API key).
- **What Chorus uses:** plain `claude -p --no-session-persistence --disable-slash-commands`. Chorus does NOT pass `--bare`, because `--bare` forces `ANTHROPIC_API_KEY` and refuses to read OAuth. The trade-off: spawned Claude calls will load your plugins. The recursion guard prevents Chorus from invoking itself.
- **Verifying:** `claude --version` and `claude -p "hi" --no-session-persistence --output-format json` should both succeed.

## OpenAI Codex CLI

- **Auth model:** `codex login` (ChatGPT account) or `OPENAI_API_KEY`. Chorus uses whichever is configured.
- **Where credentials live:** `~/.codex/auth.json`.
- **What Chorus uses:** `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral`. The `--ephemeral` flag prevents the buddy call from polluting your Codex session history.
- **Verifying:** `codex login status` should print "Logged in".

## xAI Grok CLI

- **Auth model:** xAI account login via `grok` (interactive first run) or token-based; SuperGrok subscription required for the heavier models.
- **Where credentials live:** `~/.grok/`.
- **What Chorus uses:** `grok -p <prompt> --output-format json --no-subagents --no-plan --no-memory --always-approve --verbatim --permission-mode default`. Three of those flags are isolation guards:
  - `--no-subagents` prevents the spawned Grok from spawning more agents inside its own process.
  - `--no-memory` keeps the buddy call from reading/writing your cross-session memory.
  - `--no-plan` skips Grok's interactive plan-confirmation step.
- **Verifying:** `grok -p "hi" --output-format json` should print a JSON object with `text`.

## OpenCode

- **Auth model:** OpenCode routes to whichever provider you've logged into (`opencode providers login`). Anthropic OAuth, OpenAI OAuth, OpenRouter API key, etc. all work.
- **Where credentials live:** `~/.local/share/opencode/auth.json`.
- **What Chorus uses:** `opencode run --pure --format json --agent chorus-buddy --dangerously-skip-permissions`. Two notable behaviours:
  - `--pure` prevents recursive plugin loading when OpenCode is the *target* of another agent's chorus call.
  - On first call, the OpenCode target driver auto-installs a `chorus-buddy` agent into `~/.config/opencode/agent/chorus-buddy.md`. This agent overrides OpenCode's default "coding agent" persona so it obeys the Chorus XML envelope and emits JSON instead of refusing to format arbitrary output.
- **Verifying:** `opencode providers list` should show at least one credential. `opencode models` should list models with a `<provider>/<model>` shape.

## What Chorus stores

| File | Contents | Sensitive? |
|---|---|---|
| `~/.chorus/capabilities.json` | binary path, version, auth status (true/false), available models | no — never includes API keys or tokens |
| `~/.chorus/jobs.jsonl` | one-line summary per call (source/target/role/duration/tokens/cost) | low — no prompt content |
| `~/.chorus/logs/*.jsonl` | per-call lifecycle events (spawn argv, exit codes, timing) | low — argv may include schema paths but not prompt content |
| `~/.chorus/logs/*.payload.json` | full prompt + stdout + stderr from the target | **yes** — chmod 600, never returned to caller's context, gitignored. May contain anything the buddy CLI emitted, which could include code, error messages, or other content from your working tree |

The split between the index/log files (low sensitivity) and the payload sidecar (full content) is deliberate — see `docs/observability.md`.

## When auth breaks

1. Run `chorus doctor`. The output marks any unavailable target.
2. Re-authenticate via that target's own login command (`codex login`, `grok` interactive, `opencode providers login`, `claude login`).
3. Re-run `chorus setup` to refresh `~/.chorus/capabilities.json`.

`chorus call --target X` against an unavailable target returns `{ok: false, error: "target_unavailable", hint: …}` — never silently falls back to another CLI. To pick a different target automatically when one is unauth'd, omit `--target` and let the role's `default_target_order` resolve to the next available CLI.
