#!/usr/bin/env bash
# BRU-492 preparation: SANDBOX-SAFE check. Runs the real Auth + metadata suite
# against an already-running disposable stack (started by the operator with
# `stack.sh start`, outside any sandbox), then applies the fail-closed report
# gate and its negative checks. Never starts Docker, never needs network beyond
# loopback. Missing state fails; it never skips.
#   bash verification/auth-metadata/run-checks.sh
set -euo pipefail
STATE="${ANALYTICOOL_AUTH_STACK_STATE:-$HOME/.local/state/analyticool-bru492}/stack.env"
[ -r "$STATE" ] || { echo "auth-metadata: no stack state at $STATE; the operator must run stack.sh start first" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$STATE"
set +a
REPORT="$(mktemp -d)/auth-metadata-report.json"
status=0
pnpm exec vitest run --config verification/auth-metadata/vitest.config.ts \
  --reporter=default --reporter=json --outputFile.json="$REPORT" || status=$?
node scripts/assert-auth-metadata-report.mjs "$REPORT"
node scripts/check-auth-metadata-gate.mjs "$REPORT"
exit "$status"
