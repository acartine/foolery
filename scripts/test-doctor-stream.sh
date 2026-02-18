#!/usr/bin/env bash
# Test foolery doctor against a locally-built binary and server.
#
# Usage:
#   bash scripts/test-doctor-stream.sh [--fix]
#
# Builds the CLI from source, starts a server on a test port, and runs
# `foolery doctor` (or `foolery doctor --fix`) using the built binary.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FOOLERY_DEV_PORT:-3211}"
TEST_DIR="$ROOT_DIR/.test-doctor"
TEST_CLI="$TEST_DIR/foolery"
STATE_DIR="$TEST_DIR/state"

fix_flag=""
for arg in "$@"; do
  case "$arg" in
    --fix) fix_flag="--fix" ;;
  esac
done

we_started=0

cleanup() {
  if ((we_started)); then
    FOOLERY_PORT="$PORT" FOOLERY_STATE_DIR="$STATE_DIR" "$TEST_CLI" stop 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Build Next.js production app
echo "Building Next.js app..."
(cd "$ROOT_DIR" && bun run build) >/dev/null 2>&1

# 2. Build the CLI binary from source
mkdir -p "$TEST_DIR" "$STATE_DIR"
echo "Building CLI from source..."
bash "$ROOT_DIR/scripts/build-cli.sh" "$TEST_CLI"

# 3. Kill anything already on the test port, then start our server
stale_pid="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
if [[ -n "$stale_pid" ]]; then
  echo "Killing stale process on port $PORT (pid $stale_pid)..."
  kill $stale_pid 2>/dev/null || true
  sleep 1
fi

we_started=1
echo "Starting test server on port $PORT..."
FOOLERY_PORT="$PORT" FOOLERY_NO_BROWSER=1 FOOLERY_STATE_DIR="$STATE_DIR" \
  FOOLERY_WAIT_FOR_READY=1 "$TEST_CLI" start

# 4. Run the test
echo ""
FOOLERY_PORT="$PORT" FOOLERY_STATE_DIR="$STATE_DIR" "$TEST_CLI" doctor $fix_flag
