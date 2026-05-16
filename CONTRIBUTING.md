# Contributing To Chorus

## Quickstart

```bash
git clone https://github.com/ghaaf-labs/chorus.git
cd chorus
npm ci
npm run lint
npm test
npm run eval:check
./bin/chorus help
```

Use Node.js 22.14 or newer. CI runs Node 22.14 and 24 on Linux and macOS.

## Working Rules

- Use Conventional Commits: `feat(scope): summary`, `fix(scope): summary`,
  `docs(scope): summary`, `test(scope): summary`.
- Keep one concept per commit.
- Put tests in the same commit as behavior changes.
- Update `CHANGELOG.md` under `Unreleased`.
- Preserve the normalized `verdict` field on every role schema.
- Do not silently swallow errors unless a comment explains why the failure is
  non-critical.

## PR Checklist

- [ ] Linked Linear issue
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run eval:check`
- [ ] `npm audit signatures`
- [ ] `npm audit --omit=dev`
- [ ] `npm pack --dry-run --json` checked for package contents

If you add a subcommand, update CLI help, docs, and e2e smoke coverage. If you
add a target, update capability probing, role fallbacks, tests, and
`docs/vendor-capabilities.md`.

## Architecture Map

- `core/src/cli.mjs` — subcommand router
- `core/src/invoke.mjs` — common call path for every target
- `core/src/council.mjs` and `core/src/moa.mjs` — fan-out and layering
- `core/src/targets/*.mjs` — target drivers
- `core/src/runners/*.mjs` — subprocess and ACP transport
- `roles/*.md` and `core/src/schemas/*.schema.json` — role contracts

## Code Of Conduct

By participating you agree to follow `CODE_OF_CONDUCT.md`.
