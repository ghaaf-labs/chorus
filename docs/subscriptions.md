# Using Chorus with your existing subscriptions

Chorus is built so you can run a multi-CLI mesh on subscriptions you already
pay for. It does not need API keys. It does not bill anything itself. It shells
out to each vendor's official CLI, and those CLIs use whichever auth you set up.

This page is the current truth as of May 2026. The landscape shifted hard in Q1-Q2 2026 (Anthropic banned third-party tools from using Pro/Max OAuth on April 4) — the strategy below works around all of it.

## What Chorus is, in this context

Chorus is not a third-party harness. It is not a proxy. It is not an SDK wrapper. It spawns each official CLI as a separate subprocess on your machine, with that CLI's own credentials, sandbox, and quota. Each subprocess thinks it is being run by you. The Anthropic April 4 third-party ban applies to tools that intercept OAuth tokens and re-route them to the Anthropic API directly (OpenClaw, OpenCode-via-Anthropic, Cline, RooCode, etc). Chorus shells out to the official `claude` binary instead, so it inherits whatever auth the user already configured. The ban does not apply.

## Recommended subscription stack

If you want to maximize coverage at the lowest total cost:

| You have | Chorus targets it unlocks | Monthly cost |
|---|---|---|
| Anthropic Pro | claude-code | $20 |
| ChatGPT Plus | codex *and* opencode (via OpenAI provider) | $20 |
| SuperGrok | grok | $30–$300 |

Bundling Pro + Plus + a Grok tier gives you the core Chorus mesh with zero
per-call API costs inside subscription quotas. Grok edges can be slower, but
they stay inside the CLI quota once your tier includes CLI access.

## Per-target subscription details

### Claude Code

- **Auth command:** `claude login` (opens browser)
- **What covers it:** Anthropic Pro ($20/mo), Max 5x ($100/mo), Max 20x ($200/mo), Team, Enterprise
- **What Chorus passes:** `claude -p --no-session-persistence --disable-slash-commands --output-format json`
- **Critical:** Chorus does NOT pass `--bare`. `--bare` would force `ANTHROPIC_API_KEY` and ignore the OAuth keychain entry. The recursion guard (`CHORUS_DEPTH`) keeps the spawned Claude from re-entering Chorus.
- **What about the third-party ban?** It targets *external harnesses* that route OAuth tokens to the Anthropic API. Chorus calls the official `claude` binary, which Anthropic obviously can't ban itself from. Subscription works.

### OpenAI Codex CLI

- **Auth command:** `codex login`, choose "Sign in with ChatGPT"
- **What covers it:** ChatGPT Plus ($20/mo), Pro ($200/mo), Business, Enterprise/Edu
- **Free credits:** Plus users get $5 / Pro users get $50 in API credits for 30 days after `codex login`, redeemable as overflow when your CLI quota runs out
- **What Chorus passes:** `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral`
- **`--ephemeral` matters:** without it, every Chorus call would land in your visible Codex session list and pollute history

### xAI Grok CLI

- **Auth command:** `grok` (interactive, opens browser)
- **What covers it:** access to the `grok build` CLI itself currently requires SuperGrok Heavy or the SuperGrok Build tier (intro $99/mo through May 31; list $299/mo). SuperGrok Lite ($10) and Standard ($30) cover web/chat use of Grok but historically not the CLI; xAI opened the public beta on May 14 2026, so the gating is loosening — check `grok --version` to confirm yours works.
- **What Chorus passes:** `grok -p <prompt> --output-format json --no-subagents --no-plan --no-memory --always-approve --verbatim --permission-mode default`
- **Slowest target.** Cold start runs 5-10 s before the model even thinks. Expect council fan-out where Grok participates to be bottlenecked by the Grok call.

### OpenCode

OpenCode is the one with caveats. It is a *router*, not a model — it talks to whichever provider you've logged in with via `opencode providers login`. The Chorus driver invokes `opencode run --pure --format json --agent chorus-buddy --dangerously-skip-permissions`, and OpenCode then routes that call to a model. The cost and entitlement come from the provider, not from OpenCode.

| OpenCode provider | Works through OpenCode? | Notes |
|---|---|---|
| `openai` (ChatGPT Plus/Pro) | ✅ Yes | Official OpenAI ↔ OpenCode partnership (Mar 2026) |
| `anthropic` (Claude Pro/Max OAuth) | ❌ **Server-side blocked since April 4, 2026** | Anthropic legal requested OpenCode strip the Pro/Max code paths; PR #18186 merged Mar 19. Direct API keys still work. |
| `anthropic` (Anthropic API key) | ✅ Yes | Pay-as-you-go API billing; not subscription |
| `openrouter` (OpenRouter API key) | ✅ Yes | OpenRouter handles its own subs/billing |
| `zai` (Z.AI Coding Plan) | ✅ Yes | Cheap Chinese-model coverage; useful overflow |
| `github-copilot` (Copilot subscription) | ✅ Yes | If your employer covers it |

**Recommended OpenCode setup for Chorus users**:
- Run `opencode providers login` and configure **at minimum the `openai` provider** — that's the one with subscription-backed access that survives the Anthropic ban.
- The Chorus `opencode` target driver passes `--model opencode/...` (model strings are provider-prefixed in OpenCode's view). Override with `--model anthropic/...` only if you have an Anthropic API key configured — OAuth no longer works through OpenCode.

## What `chorus doctor` tells you

`chorus doctor` calls each CLI's own `--version`. It reports availability and version, but **it cannot tell you which auth method each CLI is using**, because the CLIs don't expose that uniformly.

To check auth state per target:

```
claude --version                # works = OAuth or API key configured
codex login status              # prints "Logged in using ChatGPT" or "Logged in (API key)"
grok auth status 2>&1 || grok   # if the auth subcommand exists, it'll print sub tier
opencode providers list         # shows which providers have credentials
```

A future Chorus release may scrape these into the capability registry as an `auth: oauth | api_key | subscription | unknown` field.

## Cost economics

If you only count per-call API costs (which Chorus reports as `cost_usd_estimate`):

| Setup | Per-call cost | Coverage |
|---|---|---|
| API keys (no subscription) | Pay-per-token, ~$0.001-$0.20 per call depending on model and prompt size | Full mesh |
| Subscriptions only (Pro + Plus + SuperGrok Lite, ~$60/mo) | **$0 inside your subscription quotas**; overflows to API keys if configured | claude-code, codex, grok, plus opencode-via-openai |
| Mixed (subs + Anthropic API key + OpenRouter) | Subs cover most; API keys overflow | Full mesh with no quota anxiety |

`chorus benchmark` will still print API-equivalent cost estimates even when you're operating inside subscription quotas — this is useful for tracking what you *would* be spending if you had to bill it.

## Watching for changes

The vendor landscape moved twice in Q1-Q2 2026 (Anthropic third-party ban; OpenAI ↔ OpenCode partnership). If something stops working after a CLI upgrade:

1. Run `chorus doctor` to confirm the binaries still detect.
2. Run that target's native auth check (see above) to confirm the credential is still valid.
3. Run `chorus benchmark --targets <single-target>` to verify the *call* round-trips.
4. If a vendor changed their CLI output shape, the relevant `core/src/targets/*.mjs` extractor needs an update. Recent precedent: Codex 0.130 changed from `msg.agent_message` to `item.completed.item.agent_message` — Chorus handles both.
