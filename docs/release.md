# Release

This page is the operator checklist for publishing Chorus.

## Prerequisites

- GitHub repository: `ghaaf-labs/chorus`.
- GitHub environment: `npm`.
- npm package name: `@chorus/cli`.
- npm Trusted Publishing configured for:
  - owner: `ghaaf-labs`
  - repository: `chorus`
  - workflow: `release.yml`
  - environment: `npm`

Do not add an `NPM_TOKEN` secret. The release workflow uses GitHub OIDC and
`npm publish --provenance`.

## Preflight

Run from the repo root:

```bash
npm ci
npm run lint
npm test
npm run eval:check
npm audit --omit=dev
npm audit signatures
npm pack --dry-run --json
npm publish --dry-run --provenance --access public
```

The pack manifest must not contain tests, logs, payload sidecars, `node_modules`,
or symlink-backup files.

## Tag

Only push the release tag after npm Trusted Publishing is configured.

```bash
git fetch origin
git switch main
git pull --ff-only
git tag -a v0.1.0 -m "chorus v0.1.0"
git push origin v0.1.0
```

The tag triggers `.github/workflows/release.yml`, which runs the validation
suite, generates a CycloneDX SBOM, publishes to npm with provenance, and creates
a GitHub Release with the SBOM and pack manifest attached.

## Verify

```bash
npm view @chorus/cli@0.1.0 --json | jq '.dist.attestations'
npm install -g @chorus/cli@0.1.0
chorus version
chorus doctor
```

If publication fails before npm receives the package, fix the workflow or npm
Trusted Publishing setup and re-run the tag workflow. If npm receives a broken
package, publish a patch version; do not overwrite a released version.
