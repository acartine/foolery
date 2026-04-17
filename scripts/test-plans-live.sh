#!/usr/bin/env bash
# Live validation of the execution-plan REST API against a real Knots repo.
#
# Exercises POST /api/plans and GET /api/plans/:id end-to-end. The default
# target is /Users/cartine/stitch via a disposable git worktree so the primary
# Stitch checkout does not accumulate plan knots from each run.
#
# Usage:
#   bash scripts/test-plans-live.sh
#
# Environment overrides:
#   FOOLERY_PLAN_REPO         Source Knots repo (default /Users/cartine/stitch)
#   FOOLERY_PLAN_WORKTREE     Disposable repo path (default $TEST_DIR/repo)
#   FOOLERY_PLAN_BEAT_IDS     Comma-separated beat ids to plan over
#   FOOLERY_PLAN_BEAT_LIMIT   Auto-pick this many beats when ids unset (default 1)
#   FOOLERY_PLAN_MODEL        Optional model override forwarded to POST /api/plans
#   FOOLERY_PLAN_OBJECTIVE    Optional plan objective string
#   FOOLERY_DEV_PORT          Dev server port (default 3327)
#   FOOLERY_KEEP_TEST_DIR     Set to 1 to keep $TEST_DIR after a successful run
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FOOLERY_DEV_PORT:-3327}"
SOURCE_REPO="${FOOLERY_PLAN_REPO:-/Users/cartine/stitch}"
TEST_DIR="$ROOT_DIR/.test-plans-live"
TEST_LOG_DIR="$TEST_DIR/logs"
DEV_LOG="$TEST_LOG_DIR/dev.log"
DISPOSABLE_REPO_BASENAME="${FOOLERY_PLAN_WORKTREE_BASENAME:-$(basename "${FOOLERY_PLAN_REPO:-/Users/cartine/stitch}")}"
DISPOSABLE_REPO_DEFAULT="$TEST_DIR/$DISPOSABLE_REPO_BASENAME"
DISPOSABLE_REPO="${FOOLERY_PLAN_WORKTREE:-$DISPOSABLE_REPO_DEFAULT}"
KEEP_TEST_DIR="${FOOLERY_KEEP_TEST_DIR:-0}"
BEAT_LIMIT="${FOOLERY_PLAN_BEAT_LIMIT:-1}"
DEV_PID=""
WORKTREE_OWNED_BY_TEST="0"

log() { printf '[test-plans-live] %s\n' "$*"; }
fail() {
  printf '[test-plans-live] ERROR: %s\n' "$*" >&2
  if [[ -f "$DEV_LOG" ]]; then
    printf '[test-plans-live] Dev log: %s\n' "$DEV_LOG" >&2
  fi
  exit 1
}

cleanup() {
  local status=$?
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  if [[ $status -ne 0 ]] || [[ "$KEEP_TEST_DIR" == "1" ]]; then
    if [[ -d "$DISPOSABLE_REPO" ]]; then
      printf '[test-plans-live] Preserved disposable repo at %s\n' \
        "$DISPOSABLE_REPO" >&2
    fi
    return
  fi
  if [[ "$WORKTREE_OWNED_BY_TEST" == "1" ]] && [[ -d "$DISPOSABLE_REPO" ]]; then
    git -C "$SOURCE_REPO" worktree remove --force "$DISPOSABLE_REPO" \
      >/dev/null 2>&1 || true
    rm -rf "$DISPOSABLE_REPO"
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

prepare_dirs() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_LOG_DIR"
  git -C "$SOURCE_REPO" worktree prune >/dev/null 2>&1 || true
}

ensure_source_repo() {
  if [[ ! -d "$SOURCE_REPO" ]]; then
    fail "FOOLERY_PLAN_REPO does not exist: $SOURCE_REPO"
  fi
  if [[ ! -d "$SOURCE_REPO/.knots" ]]; then
    fail "FOOLERY_PLAN_REPO has no .knots/ directory: $SOURCE_REPO"
  fi
  if ! command -v kno >/dev/null 2>&1; then
    fail "kno CLI not found on PATH; install Knots before running this harness."
  fi
}

prepare_disposable_repo() {
  if [[ -n "${FOOLERY_PLAN_WORKTREE:-}" ]]; then
    if [[ ! -d "$DISPOSABLE_REPO/.knots" ]]; then
      fail "FOOLERY_PLAN_WORKTREE has no .knots/ directory: $DISPOSABLE_REPO"
    fi
    log "Using caller-provided worktree at $DISPOSABLE_REPO (no auto-cleanup)."
    return
  fi
  if ! git -C "$SOURCE_REPO" rev-parse --git-dir >/dev/null 2>&1; then
    fail "Source repo is not a git checkout: $SOURCE_REPO"
  fi
  log "Creating disposable git worktree from $SOURCE_REPO at $DISPOSABLE_REPO..."
  git -C "$SOURCE_REPO" worktree add --detach "$DISPOSABLE_REPO" \
    >/dev/null
  WORKTREE_OWNED_BY_TEST="1"
  log "Copying .knots/ payload into disposable worktree..."
  cp -R "$SOURCE_REPO/.knots" "$DISPOSABLE_REPO/.knots"
}

resolve_beat_ids() {
  if [[ -n "${FOOLERY_PLAN_BEAT_IDS:-}" ]]; then
    BEAT_IDS="$FOOLERY_PLAN_BEAT_IDS"
    log "Using caller-provided beat ids: $BEAT_IDS"
    return
  fi
  log "Auto-selecting up to $BEAT_LIMIT non-plan beat id(s) from $DISPOSABLE_REPO..."
  BEAT_IDS="$(
    kno -C "$DISPOSABLE_REPO" ls --json \
      | node -e '
          const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
          const limit = Number(process.argv[1]) || 1;
          const ids = (Array.isArray(data) ? data : [])
            .filter((knot) =>
              knot && typeof knot === "object" &&
              knot.type !== "execution_plan" &&
              typeof knot.id === "string"
            )
            .map((knot) => knot.id)
            .sort()
            .slice(0, limit);
          process.stdout.write(ids.join(","));
        ' "$BEAT_LIMIT"
  )"
  if [[ -z "$BEAT_IDS" ]]; then
    fail "Could not auto-select any beats from $DISPOSABLE_REPO"
  fi
  log "Selected beat ids: $BEAT_IDS"
}

wait_for_dev() {
  local attempts=120
  while ((attempts > 0)); do
    if [[ -n "$DEV_PID" ]] && ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
      fail "Dev server exited early. Check $DEV_LOG"
    fi
    if curl --silent --show-error --max-time 1 \
      "http://127.0.0.1:$PORT/api/registry" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  fail "Timed out waiting for dev server on port $PORT"
}

start_dev_server() {
  local stale_pid
  stale_pid="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [[ -n "$stale_pid" ]]; then
    log "Killing stale process on port $PORT (pid $stale_pid)..."
    kill $stale_pid 2>/dev/null || true
    sleep 1
  fi
  log "Starting dev server on port $PORT (logs: $DEV_LOG)..."
  (
    cd "$ROOT_DIR"
    bun run dev -- --hostname 127.0.0.1 --port "$PORT" \
      >"$DEV_LOG" 2>&1
  ) &
  DEV_PID=$!
  wait_for_dev
}

run_validator() {
  local model_arg=""
  local objective_arg=""
  if [[ -n "${FOOLERY_PLAN_MODEL:-}" ]]; then
    model_arg="--model=$FOOLERY_PLAN_MODEL"
  fi
  if [[ -n "${FOOLERY_PLAN_OBJECTIVE:-}" ]]; then
    objective_arg="--objective=$FOOLERY_PLAN_OBJECTIVE"
  fi
  log "Running live plan validator..."
  node "$ROOT_DIR/scripts/test-plans-live.mjs" \
    "--base-url=http://127.0.0.1:$PORT" \
    "--repo=$DISPOSABLE_REPO" \
    "--beats=$BEAT_IDS" \
    "--dev-log=$DEV_LOG" \
    ${model_arg:+"$model_arg"} \
    ${objective_arg:+"$objective_arg"}
}

prepare_dirs
ensure_source_repo
prepare_disposable_repo
resolve_beat_ids
start_dev_server
run_validator

log "PASS: live execution-plan validation succeeded."
