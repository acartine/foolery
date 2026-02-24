#!/usr/bin/env bash
# Test foolery start/restart settings backfill against a locally-built binary.
#
# Usage:
#   bash scripts/test-start-restart-settings.sh
#
# Builds the app + CLI from source, runs start and restart in an isolated HOME,
# intentionally removes settings keys, and verifies startup backfills defaults.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FOOLERY_DEV_PORT:-3212}"
TEST_DIR="$ROOT_DIR/.test-start-restart"
TEST_CLI="$TEST_DIR/foolery"
TEST_HOME="$TEST_DIR/home"
STATE_DIR="$TEST_DIR/state"
CONFIG_DIR="$TEST_HOME/.config/foolery"
SETTINGS_FILE="$CONFIG_DIR/settings.toml"
REGISTRY_FILE="$CONFIG_DIR/registry.json"

we_started=0

fail() {
  printf '[test-start-restart-settings] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[test-start-restart-settings] %s\n' "$*"
}

cleanup() {
  if ((we_started)); then
    HOME="$TEST_HOME" FOOLERY_PORT="$PORT" FOOLERY_STATE_DIR="$STATE_DIR" "$TEST_CLI" stop 2>/dev/null || true
  fi
}
trap cleanup EXIT

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    printf '[test-start-restart-settings] Expected to find "%s" in %s\n' "$needle" "$file" >&2
    printf '\n----- %s -----\n' "$file" >&2
    cat "$file" >&2 || true
    printf '\n-----------------\n' >&2
    exit 1
  fi
}

write_partial_settings() {
  mkdir -p "$CONFIG_DIR"
  cat >"$SETTINGS_FILE" <<'TOML'
[agent]
command = "claude"

[actions]
take = ""
scene = ""
direct = ""
breakdown = ""
TOML
}

write_legacy_registry() {
  mkdir -p "$CONFIG_DIR"
  cat >"$REGISTRY_FILE" <<JSON
{
  "repos": [
    {
      "path": "$ROOT_DIR",
      "name": "$(basename "$ROOT_DIR")",
      "addedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
JSON
}

verify_backfilled_settings() {
  [[ -f "$SETTINGS_FILE" ]] || fail "Missing settings file: $SETTINGS_FILE"
  assert_contains "[verification]" "$SETTINGS_FILE"
  assert_contains "enabled = false" "$SETTINGS_FILE"
  assert_contains 'agent = ""' "$SETTINGS_FILE"
}

verify_backfilled_registry() {
  [[ -f "$REGISTRY_FILE" ]] || fail "Missing registry file: $REGISTRY_FILE"
  assert_contains '"memoryManagerType": "beads"' "$REGISTRY_FILE"
}

log "Preparing isolated test dirs..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR" "$STATE_DIR" "$CONFIG_DIR"

log "Building Next.js app..."
(cd "$ROOT_DIR" && bun run build) >/dev/null 2>&1

log "Building CLI from source..."
bash "$ROOT_DIR/scripts/build-cli.sh" "$TEST_CLI" >/dev/null

stale_pid="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
if [[ -n "$stale_pid" ]]; then
  log "Killing stale process on port $PORT (pid $stale_pid)..."
  kill $stale_pid 2>/dev/null || true
  sleep 1
fi

log "Writing legacy settings and registry files with missing defaults..."
write_partial_settings
write_legacy_registry

log "Running start and waiting for readiness..."
we_started=1
HOME="$TEST_HOME" FOOLERY_PORT="$PORT" FOOLERY_NO_BROWSER=1 FOOLERY_WAIT_FOR_READY=1 FOOLERY_STATE_DIR="$STATE_DIR" \
  "$TEST_CLI" start

log "Verifying start backfilled missing settings..."
verify_backfilled_settings
verify_backfilled_registry

log "Removing defaults again to test restart path..."
write_partial_settings
write_legacy_registry

log "Running restart and waiting for readiness..."
HOME="$TEST_HOME" FOOLERY_PORT="$PORT" FOOLERY_NO_BROWSER=1 FOOLERY_WAIT_FOR_READY=1 FOOLERY_STATE_DIR="$STATE_DIR" \
  "$TEST_CLI" restart

log "Verifying restart backfilled missing settings..."
verify_backfilled_settings
verify_backfilled_registry

log "PASS: start/restart backfilled missing settings and memory manager metadata in $CONFIG_DIR"
