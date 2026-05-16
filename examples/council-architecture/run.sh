#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
if [ "${CHORUS_EXAMPLE_LIVE:-0}" != "1" ]; then
  echo "skip: set CHORUS_EXAMPLE_LIVE=1 to call real targets"
  exit 0
fi
export CHORUS_PROBE_TIMEOUT_MS="${CHORUS_PROBE_TIMEOUT_MS:-1000}"
export CHORUS_BUDGET_PATH="${CHORUS_BUDGET_PATH:-${TMPDIR:-/tmp}/chorus-example-empty-budget.json}"
./bin/chorus setup --quiet
TARGETS="$(node -e 'const fs=require("fs"),os=require("os"),path=require("path"); const p=path.join(os.homedir(),".chorus","capabilities.json"); const j=JSON.parse(fs.readFileSync(p,"utf8")); const order=["codex","grok","opencode","claude-code","grok-build","copilot"]; console.log(order.filter(t=>j.hosts?.[t]?.available).slice(0,3).join(","));')"
if [ "$(printf "%s" "$TARGETS" | awk -F, '{print NF}')" -lt 3 ] || [ -z "$TARGETS" ]; then
  echo "skip: fewer than three council targets available"
  exit 0
fi
./bin/chorus council --role architect --targets "$TARGETS" --quorum 2-of-3 --task "Propose a production release architecture for a CLI package." --force
