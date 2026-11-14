#!/usr/bin/env bash
# Start a disposable, synthetic-only PostgreSQL cluster and run the tenant
# isolation suite against it. Nothing persists: the cluster lives in a temp
# directory that is removed on exit. Requires initdb/pg_ctl/psql (16+) on PATH
# or PGBIN pointing at their directory. Usage, from the repository root:
#   PGBIN=/opt/homebrew/opt/postgresql@17/bin bash verification/postgres-isolation/run-local.sh
set -euo pipefail
if [ -n "${PGBIN:-}" ]; then export PATH="$PGBIN:$PATH"; fi
ROOT="$(mktemp -d)"
PORT="${PGPORT_OVERRIDE:-$((20000 + RANDOM % 20000))}"
printf 'postgres\n' >"$ROOT/pw"
initdb -D "$ROOT/data" -U postgres --pwfile="$ROOT/pw" --auth=scram-sha-256 -E UTF8 --no-locale >/dev/null
pg_ctl -D "$ROOT/data" -l "$ROOT/server.log" -w -o "-c listen_addresses=localhost -p $PORT -k $ROOT -c dynamic_shared_memory_type=mmap" start >/dev/null
trap 'pg_ctl -D "$ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT
echo "postgres-isolation: $(postgres --version), $(psql --version), port $PORT"
ANALYTICOOL_PG_TEST_ADMIN_URL="postgres://postgres:postgres@localhost:$PORT/postgres" \
  pnpm exec vitest run --config verification/postgres-isolation/vitest.config.ts "$@"
