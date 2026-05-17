# Changelog

All notable changes to Chorus are recorded here. This project follows Keep a
Changelog style and uses Conventional Commits.

## [Unreleased]

### Added

- `chorus install` / `chorus uninstall` register the per-host adapter as a
  plugin for Claude Code, Codex CLI, Grok, and OpenCode. Default mode is
  `copy`; `--link` symlinks for dev.
- `chorus init --yes` now auto-registers Chorus as a plugin for every host
  it detects. Interactive init prompts before registering.
- `chorus doctor` reports per-host plugin registration status and suggests
  `chorus install` when a host is detected but not registered.

### Fixed

- Plugin manifests (`adapters/{claude,codex,grok}/.{host}-plugin/plugin.json`)
  declared `Apache-2.0` and the wrong GitHub org; corrected to `MIT` and
  `ghaaf-labs/chorus` to match the root package.

## [0.1.0] - 2026-05-16

### Added

- Multi-CLI mesh for Claude Code, Codex CLI, Grok CLI, OpenCode, Grok Build,
  GitHub Copilot CLI, and Knowledge Index.
- Role system with reviewer, researcher, architect, devils-advocate,
  retriever, judge, refactor-scribe, test-writer, bisector, and profiler.
- ACP client/server support, replay, lineage, council consensus, judge mode,
  Mixture-of-Agents, cost firewall, OTel JSONL export, and Trust v1.
- Prompt redaction, untrusted input wrapping, canary checking and fuzzing,
  verdict drift detection, and placeholder-leak quarantine.

### Fixed

- Cross-vendor model carry, ACP token fallback, verdict normalization,
  duplicate council target weighting, sparse MoA layers, and unreadable payload
  handling.
