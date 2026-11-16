#!/usr/bin/env bash
# BRU-492 preparation only. Operator-controlled lifecycle for a disposable LOCAL
# Supabase Auth + PostgreSQL stack used by verification/auth-metadata.
#
# Run this OUTSIDE any sandbox: it talks to the Docker daemon, which is
# host-level power. Repository checks never call it; they only reach the
# loopback endpoints recorded in the state file written by `start`.
#
#   bash verification/auth-metadata/stack.sh prefetch   # pull + verify pinned images
#   bash verification/auth-metadata/stack.sh start      # start db+auth+kong, verify, write state
#   bash verification/auth-metadata/stack.sh stop       # stop, drop volumes and network, remove state
#
# Environment:
#   SUPABASE_BIN   Supabase CLI 3.1.0 (default: the checksum-verified operator install below)
#   ANALYTICOOL_AUTH_STACK_STATE  state dir (default: $HOME/.local/state/analyticool-bru492)
#
# All credentials are the Supabase CLI's fixed, publicly documented LOCAL
# defaults ("shared defaults, do not use in production"). Nothing here touches
# a hosted Supabase project.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_VERSION="3.1.0"
SUPABASE_BIN="${SUPABASE_BIN:-$HOME/.local/share/analyticool-tools/supabase-cli-$CLI_VERSION/bin/supabase}"
STATE_DIR="${ANALYTICOOL_AUTH_STACK_STATE:-$HOME/.local/state/analyticool-bru492}"
NETWORK="analyticool-bru492-verify"
SUBNET="10.249.92.0/24"
PROJECT="analyticool-bru492-verify"
API_PORT=55421
DB_PORT=55422
EXCLUDE="realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

die() { echo "auth-stack: $*" >&2; exit 1; }
log() { echo "auth-stack: $*"; }

check_cli() {
  [ -x "$SUPABASE_BIN" ] || die "Supabase CLI not found at $SUPABASE_BIN (see the preparation report for the pinned install)"
  local v
  v="$("$SUPABASE_BIN" --version 2>/dev/null | tail -1)"
  [ "$v" = "$CLI_VERSION" ] || die "Supabase CLI $CLI_VERSION required, found '$v'"
}

# Verify every locked image is present locally with the locked manifest digest.
verify_images() {
  local ref digest repo
  while read -r ref digest; do
    case "$ref" in ''|'#'*) continue ;; esac
    repo="${ref%:*}"
    docker image inspect "$ref" --format '{{join .RepoDigests "\n"}}' 2>/dev/null |
      grep -qx "$repo@$digest" || die "image $ref does not match locked digest $digest"
  done <"$HERE/images.lock"
}

prefetch() {
  check_cli
  local ref digest
  while read -r ref digest; do
    case "$ref" in ''|'#'*) continue ;; esac
    docker pull --quiet "${ref%:*}@$digest" >/dev/null
    docker tag "${ref%:*}@$digest" "$ref"
  done <"$HERE/images.lock"
  verify_images
  log "pinned images present and verified"
}

ensure_network() {
  if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
    # Default host binding 127.0.0.1: the CLI publishes ports without a host IP,
    # which would otherwise listen on every interface.
    docker network create --driver bridge --subnet "$SUBNET" \
      --label analyticool.bru492=verification \
      -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$NETWORK" >/dev/null
  fi
  [ "$(docker network inspect "$NETWORK" --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}')" = "127.0.0.1" ] ||
    die "network $NETWORK must default host bindings to 127.0.0.1"
}

verify_running() {
  local c image_id bindings
  for c in supabase_db_$PROJECT supabase_auth_$PROJECT supabase_kong_$PROJECT; do
    [ "$(docker inspect "$c" --format '{{.State.Running}}' 2>/dev/null)" = "true" ] || die "$c is not running"
    image_id="$(docker inspect "$c" --format '{{.Image}}')"
    docker image inspect "$image_id" --format '{{join .RepoDigests "\n"}}' |
      grep -qxFf <(awk '!/^#/ && NF==2 { r=$1; sub(/:[^:]*$/, "", r); print r "@" $2 }' "$HERE/images.lock") ||
      die "$c runs an image outside images.lock"
    bindings="$(docker inspect "$c" --format '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{end}}{{end}}')"
    for ip in $bindings; do [ "$ip" = "127.0.0.1" ] || die "$c publishes on $ip (loopback only allowed)"; done
  done
  # Exactly the three expected containers in this project.
  local n
  n="$(docker ps --filter "label=com.supabase.cli.project=$PROJECT" -q | wc -l | tr -d ' ')"
  [ "$n" = "3" ] || die "expected 3 containers for $PROJECT, found $n"
}

start() {
  check_cli
  verify_images
  ensure_network
  "$SUPABASE_BIN" start --workdir "$HERE" --network-id "$NETWORK" -x "$EXCLUDE" >/dev/null
  verify_running
  local status pub sec
  status="$("$SUPABASE_BIN" status --workdir "$HERE" -o env 2>/dev/null)"
  pub="$(printf '%s\n' "$status" | sed -n 's/^PUBLISHABLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  sec="$(printf '%s\n' "$status" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  [ -n "$pub" ] && [ -n "$sec" ] || die "could not read local keys from supabase status"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  umask 077
  cat >"$STATE_DIR/stack.env" <<EOF
# Written by verification/auth-metadata/stack.sh. Local, disposable, synthetic.
ANALYTICOOL_AUTH_TEST_API_URL=http://127.0.0.1:$API_PORT
ANALYTICOOL_AUTH_TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:$DB_PORT/postgres
ANALYTICOOL_AUTH_TEST_PUBLISHABLE_KEY=$pub
ANALYTICOOL_AUTH_TEST_SECRET_KEY=$sec
EOF
  log "stack up on 127.0.0.1:$API_PORT (auth) and 127.0.0.1:$DB_PORT (db); state $STATE_DIR/stack.env"
}

stop() {
  check_cli
  "$SUPABASE_BIN" stop --workdir "$HERE" --no-backup >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -f "$STATE_DIR/stack.env"
  log "stopped; volumes, network and state removed"
}

case "${1:-}" in
  prefetch) prefetch ;;
  start) start ;;
  stop) stop ;;
  verify) verify_images; verify_running; log "running stack matches images.lock, loopback only" ;;
  *) die "usage: stack.sh prefetch|start|verify|stop" ;;
esac
