# Distribution

The primary channel is npm:

```bash
npm install -g @chorus/cli
```

The release workflow publishes from GitHub Actions with npm Trusted Publishing
and provenance. No long-lived `NPM_TOKEN` is required.

Secondary channels live under `dist/`:

| Channel | File | Status |
| --- | --- | --- |
| Homebrew | `dist/Formula/chorus.rb` | Template for a tap release |
| Scoop | `dist/scoop/chorus.json` | Template; Windows remains untested for v0.1.0 |
| Shell installer | `dist/install.sh` | npm-backed installer with Node version check |

Update checksums after a GitHub release artifact exists.
