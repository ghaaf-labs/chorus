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

## What's new in M7 → M11.5 (the post-M6.5 sweep)

- **M7** — `chorus lineage <job_id>` (ascii + `--json` + `--mermaid` DAG), sequential-task classifier that refuses `chorus council` on `step-by-step refactor` shapes (arxiv 2604.02460), real council consensus with weighted vote + `--quorum K-of-N`, `--parent` flag, council fan-outs link `parent_job_ids: [council_root]`.
- **M8** — `core/src/targets/knowledge.mjs` makes the GhaafRAG pipeline a peer-callable target; `roles/retriever.md` + schema; `--retrieve` flag wraps chunks in `<untrusted>` via M6.5's compose primitive and auto-runs canary check (`rag_canary_breach` quarantine); `roles/judge.md` + `--judge <target>` post-merge; Mixture-of-Agents layering via `--moa "l1=a,b; l2=c"`.
- **M9** — cost firewall (`~/.chorus/budget.json` with daily/per-call ceilings), OTel-shaped JSONL export, smart structural input truncation (preserves diff hunks + markdown sections), `AGENTS.md` auto-injection, bounded LRU validator cache, `chorus doctor --deep` 1-token round-trip, recursion-guard resolution hints.
- **M10** — Grok Build (May 14 release, parallel sub-agents + 2M ctx) + GitHub Copilot CLI ACP-native targets; `roles/refactor-scribe.md`.
- **M11** — Self-modifying playbook (`chorus playbook rebuild`), `chorus dedup` (Jaccard near-duplicate warning), `chorus regress`, `chorus bulk-query`, 3 new roles (test-writer / bisector / profiler), `chorus mcp` stub.
- **M11.5 — Chorus Trust v1** — `chorus canary fuzz` mutates seed canaries (homoglyph, base64, role-play, multilang, inject); `chorus drift` finds replayed-job verdict flips; `chorus trust report` + `chorus trust --ci` CI gate; outbound redact-placeholder invariant rejects `placeholder_leak` if model emits a placeholder it never saw; `scripts/build-leaderboard.mjs` aggregates trust reports into a static HTML dashboard. **Chorus becomes the measurement layer for cross-vendor agent safety** — no other multi-CLI mesh has the joinable substrate (canary + verdict normalization + capability matrix + lineage DAG) to do this.

## What's new in M6.5 (safety baseline + hotfix)

- **Prompt-firewall** — `chorus call --redact …` (or `CHORUS_REDACT=1`) strips emails, GitHub PATs, AWS keys, Luhn-valid CC numbers, US SSNs, private IPs, and `*.internal/*.local/*.corp/*.lan` hostnames before send; mapping persists in the `.payload.json` sidecar for replay rehydration. See `docs/safety.md`.
- **Counter-RAG canaries** — `chorus canary check` scans recent payloads for canary breach tokens; sets the stage for M8's auto-quarantine on RAG injection.
- **Untrusted-content sandbox** — `composePrompt({ untrusted: true })` wraps `<input>` in `<untrusted>…</untrusted>` and appends a standing instruction to the role's system block; off by default; M7+ retriever will turn it on.
- **Cross-vendor model translation** — `chorus replay <id> --target X` no longer carries a vendor-mismatched `--model` blindly (the 99 s timeout from M6 dogfood). New `core/src/model-map.mjs` translates known names; falls through to target default when no good mapping exists.
- **ACP token-count fallback** — Grok/OpenCode ACP modes used to return zero tokens; Chorus now estimates from byte counts and tags `tokens.estimated: true` so cost-firewall (M9) can enforce on ACP targets too.
- **Verdict normalized across all role schemas** — `verdict: "approve" | "needs-attention" | "inconclusive"` is now required by researcher/architect/devils-advocate/reviewer; unblocks M7 council consensus and M8 judge.
- **`parent_job_id` → `parent_job_ids: string[]`** — plural shape; replay-of-replay and council fan-out can append properly. Old jobs.jsonl entries remain readable.
- **Vendor capability matrix** — `docs/vendor-capabilities.md` documents per-target token, latency, cancel, and schema-enforcement gaps.

## What's new in M6

- **ACP bridges auto-detected** — install `claude-code-acp` or `codex-acp` on `$PATH` and the corresponding driver gets ACP added to its `runModes` (try `--mode acp`). `chorus doctor` shows bridge status per target.
- **`chorus replay <job_id>`** — re-run any past job against any target, role, or model. New envelope's `parent_job_id` links to the original. See `docs/replay.md`.
- **Cost column in `chorus history` / `chorus status`** + `--since 2h|30m|7d` filter.
- **`jobs.jsonl` rotation** at 50 MB (configurable via `CHORUS_JOBS_ROTATE_BYTES`), keeps `.1..10` by default.
- **`session/cancel` actually cancels** — Ctrl-C in Zed against `chorus acp` now propagates an abort through to the spawned subprocess or pooled ACP client.
- **Auto-role default** — `chorus call --task "review this diff"` (no `--role`) auto-routes via the `pickDefaultRole` heuristic; the breadcrumb shows on stderr.
- **OpenCode model over ACP** — `--model anthropic/claude-haiku-4-5` is propagated as `OPENCODE_MODEL` env to the ACP child.

## Status

v0.1 development complete. M0 through M11.5 shipped — full 6×6 mesh (Claude Code, Codex, Grok, OpenCode, Grok Build, Copilot CLI) plus Knowledge Index as a peer target, ACP both directions, 8 roles (reviewer/researcher/architect/devils-advocate/retriever/judge/refactor-scribe/test-writer/bisector/profiler), `chorus lineage`/`replay`/`dedup`/`regress`/`bulk-query`/`canary fuzz`/`drift`/`trust`/`playbook` subcommands, prompt-firewall + canary + outbound placeholder invariant, cost firewall, OTel export, MoA + judge mode. **192 tests green, 15 commits.** See `docs/acp.md`, `docs/replay.md`, `docs/safety.md`, `docs/vendor-capabilities.md`, `docs/subscriptions.md`.

## License

Apache-2.0.
