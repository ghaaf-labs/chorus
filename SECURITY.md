# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Supported after first public release |
| < 0.1   | Development pre-releases only |

## Reporting a Vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Email **dev@ghaaf.org** with:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept welcome)
- Affected Chorus version + Node.js version + OS
- Whether the issue is currently being exploited in the wild (if known)

You will receive an acknowledgment within **3 business days**. We aim to confirm or refute the report within **7 business days**.

### Disclosure window

Chorus follows a **coordinated disclosure** policy:

- **30 days** for low-severity issues
- **60 days** for medium-severity
- **90 days** for high-severity and critical

If a fix is available before the disclosure window closes, we release it as a patch version with a CVE attribution in the [`CHANGELOG.md`](./CHANGELOG.md). If we cannot ship within the window, we will request an extension from the reporter; we will not silently extend.

## Scope

In scope:

- Code execution via crafted task/input through any subcommand
- Prompt-injection escapes that defeat M11.5's outbound `placeholder_leak` invariant or the `<untrusted>` content sandbox
- Canary breach attribution failures (false negatives on the canary fuzz suite)
- Cost firewall bypass that allows unbudgeted spend
- Logging that leaks secrets to `~/.chorus/jobs.jsonl` or `.payload.json` despite `--redact`
- Supply-chain attacks against `@chorus/cli` itself (dependencies, build pipeline)

Out of scope:

- Vulnerabilities in the upstream CLIs Chorus orchestrates (Claude Code, Codex, Grok, OpenCode, Grok Build, Copilot CLI) — report to those vendors directly
- Vulnerabilities in the optional `knowledge-index` peer — report to that project
- Issues that require attacker-controlled access to `~/.chorus/` (we assume the home directory is trusted)
- Denial-of-service via expensive inputs that the user explicitly authorized (the cost firewall is the mitigation; intentionally bypassing it is user choice)

## Hall of Fame

Researchers who responsibly disclose are credited in this section after the fix ships (with their consent).

*(Empty for v0.1.0 — be the first.)*

## Supply chain

The release workflow publishes with **npm provenance attestations** via GitHub
Actions OIDC Trusted Publishing. Every public release should carry proof that
it was built from a specific commit in this repository. Verify with:

```bash
npm view @chorus/cli@<version> --json | jq '.dist.attestations'
```

A CycloneDX 1.7 SBOM is attached to every GitHub Release. Lockfile signatures
are checked in CI via `npm audit signatures`, runtime dependencies are audited
with `npm audit --omit=dev`, and Renovate waits 7 days before dependency
updates can land.
