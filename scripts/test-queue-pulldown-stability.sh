#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FOOLERY_DEV_PORT:-3324}"
TEST_DIR="$ROOT_DIR/.test-queue-pulldown-stability"
TEST_HOME="$TEST_DIR/home"
TEST_LOG_DIR="$TEST_DIR/logs"
DEV_LOG="$TEST_LOG_DIR/dev.log"
PLAYWRIGHT_CACHE="${FOOLERY_PLAYWRIGHT_CACHE:-${TMPDIR:-/tmp}/foolery-playwright-browsers}"
KEEP_TEST_DIR="${FOOLERY_KEEP_TEST_DIR:-0}"
DEV_PID=""

fail() {
  printf '[test-queue-pulldown-stability] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[test-queue-pulldown-stability] %s\n' "$*"
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
      "http://127.0.0.1:$PORT/beats?view=queues&state=queued" \
      >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  fail "Timed out waiting for dev server on port $PORT"
}

prepare_env() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_HOME" "$TEST_LOG_DIR"
}

log "Preparing isolated test home..."
prepare_env

log "Starting dev server..."
(
  cd "$ROOT_DIR"
  HOME="$TEST_HOME" \
  bun run dev -- --hostname 127.0.0.1 --port "$PORT" \
    >"$DEV_LOG" 2>&1
) &
DEV_PID=$!

wait_for_dev

log "Ensuring Playwright Chromium is installed..."
PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_CACHE" \
bunx playwright install chromium >/dev/null

log "Running Queues pulldown stability verification..."
HOME="$TEST_HOME" \
PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_CACHE" \
node "$ROOT_DIR/scripts/test-queue-pulldown-stability.mjs" \
  "http://127.0.0.1:$PORT"

log "PASS: Queues View pulldowns keep scroll and layout stable."
