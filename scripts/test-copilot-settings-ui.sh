#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FOOLERY_DEV_PORT:-3321}"
TEST_DIR="$ROOT_DIR/.test-copilot-settings-ui"
TEST_HOME="$TEST_DIR/home"
TEST_BIN="$TEST_DIR/bin"
TEST_LOG_DIR="$TEST_DIR/logs"
DEV_LOG="$TEST_LOG_DIR/dev.log"
SETTINGS_FILE="$TEST_HOME/.config/foolery/settings.toml"
PLAYWRIGHT_CACHE="${FOOLERY_PLAYWRIGHT_CACHE:-${TMPDIR:-/tmp}/foolery-playwright-browsers}"
KEEP_TEST_DIR="${FOOLERY_KEEP_TEST_DIR:-0}"
DEV_PID=""

fail() {
  printf '[test-copilot-settings-ui] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[test-copilot-settings-ui] %s\n' "$*"
}

cleanup() {
  local status=$?
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  if [[ "$KEEP_TEST_DIR" != "1" ]] && [[ $status -eq 0 ]]; then
    rm -rf "$TEST_DIR"
  fi
}
trap cleanup EXIT

wait_for_dev() {
  local attempts=60
  while ((attempts > 0)); do
    if [[ -n "$DEV_PID" ]] && ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
      fail "Dev server exited early. Check $DEV_LOG"
    fi
    if curl --silent --show-error --max-time 1 \
      "http://127.0.0.1:$PORT/beats?settings=agents" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  fail "Timed out waiting for dev server on port $PORT"
}

prepare_env() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_BIN" "$TEST_LOG_DIR" "$TEST_HOME/.copilot"

  ln -sf "$(command -v bun)" "$TEST_BIN/bun"
  ln -sf "$(command -v node)" "$TEST_BIN/node"
  ln -sf "$ROOT_DIR/scripts/test-fixtures/fake-copilot.sh" \
    "$TEST_BIN/copilot"

  cat >"$TEST_HOME/.copilot/config.json" <<'JSON'
{
  "defaultModel": "claude-sonnet-4.5"
}
JSON
}

log "Preparing isolated HOME and PATH..."
prepare_env

log "Starting dev server..."
(
  cd "$ROOT_DIR"
  HOME="$TEST_HOME" \
  PATH="$TEST_BIN:/usr/bin:/bin" \
  bun run dev -- --hostname 127.0.0.1 --port "$PORT" \
    >"$DEV_LOG" 2>&1
) &
DEV_PID=$!

wait_for_dev

log "Ensuring Playwright Chromium is installed..."
PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_CACHE" \
bunx playwright install chromium >/dev/null

log "Running Playwright verification..."
HOME="$TEST_HOME" \
PATH="$TEST_BIN:/usr/bin:/bin" \
PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_CACHE" \
node "$ROOT_DIR/scripts/test-copilot-settings-ui.mjs" \
  "http://127.0.0.1:$PORT/beats" \
  "$SETTINGS_FILE"

log "PASS: Copilot scanned and registered through Settings UI."
