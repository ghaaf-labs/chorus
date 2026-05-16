#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
if [ "${CHORUS_EXAMPLE_LIVE:-0}" != "1" ]; then
  echo "skip: set CHORUS_EXAMPLE_LIVE=1 to call real targets"
  exit 0
fi
export CHORUS_PROBE_TIMEOUT_MS="${CHORUS_PROBE_TIMEOUT_MS:-1000}"
export CHORUS_BUDGET_PATH="${CHORUS_BUDGET_PATH:-${TMPDIR:-/tmp}/chorus-example-empty-budget.json}"
if [ ! -f "../tools/knowledge-index/pyproject.toml" ] && [ -z "${CHORUS_KNOWLEDGE_INDEX_PATH:-}" ]; then
  echo "skip: knowledge-index project not found"
  exit 0
fi
./bin/chorus setup --quiet
if ! node -e 'const fs=require("fs"),os=require("os"),path=require("path"); const p=path.join(os.homedir(),".chorus","capabilities.json"); const j=JSON.parse(fs.readFileSync(p,"utf8")); process.exit(j.hosts?.codex?.available ? 0 : 1)'; then
  echo "skip: codex target unavailable"
  exit 0
fi
./bin/chorus call --target codex --role reviewer --retrieve --task "Review the workspace guidance for release safety and summarize risks." --allow-self
