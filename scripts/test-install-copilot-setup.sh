#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$ROOT_DIR/.test-install-copilot-setup"
TEST_HOME="$TEST_DIR/home"
TEST_BIN="$TEST_DIR/bin"
TEST_INSTALL_ROOT="$TEST_DIR/install"
TEST_APP_DIR="$TEST_INSTALL_ROOT/runtime"
TEST_STATE_DIR="$TEST_DIR/state"
TEST_LAUNCHER="$TEST_BIN/foolery"
SETTINGS_FILE="$TEST_HOME/.config/foolery/settings.toml"
TRANSCRIPT="$TEST_DIR/setup.typescript"
KEEP_TEST_DIR="${FOOLERY_KEEP_TEST_DIR:-0}"

fail() {
  printf '[test-install-copilot-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[test-install-copilot-setup] %s\n' "$*"
}

cleanup() {
  local status=$?
  if [[ "$KEEP_TEST_DIR" != "1" ]] && [[ $status -eq 0 ]]; then
    rm -rf "$TEST_DIR"
  fi
}
trap cleanup EXIT

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    printf '[test-install-copilot-setup] Missing "%s" in %s\n' \
      "$needle" "$file" >&2
    printf '\n----- %s -----\n' "$file" >&2
    cat "$file" >&2 || true
    printf '\n-----------------\n' >&2
    exit 1
  fi
}

artifact_path() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) fail "Unsupported arch: $(uname -m)" ;;
  esac
  printf '%s/dist/foolery-runtime-%s-%s.tar.gz\n' \
    "$ROOT_DIR" "$os" "$arch"
}

prepare_env() {
  rm -rf "$TEST_DIR"
  mkdir -p "$TEST_BIN" "$TEST_HOME/.copilot" "$TEST_STATE_DIR"

  ln -sf "$(command -v node)" "$TEST_BIN/node"
  ln -sf "$ROOT_DIR/scripts/test-fixtures/fake-copilot.sh" \
    "$TEST_BIN/copilot"

  cat >"$TEST_HOME/.copilot/config.json" <<'JSON'
{
  "defaultModel": "claude-sonnet-4.5"
}
JSON
}

run_setup_with_tty() {
  local cmd="$1"
  local input="$2"

  if ! command -v script >/dev/null 2>&1; then
    fail "Missing required command: script"
  fi

  if script --version >/dev/null 2>&1; then
    printf '%s' "$input" | script -qefc "$cmd" "$TRANSCRIPT" >/dev/null
    return 0
  fi

  printf '%s' "$input" | script -q "$TRANSCRIPT" bash -lc "$cmd" >/dev/null
}

log "Preparing isolated install directories..."
prepare_env

log "Building runtime artifact..."
(cd "$ROOT_DIR" && bun run build:runtime) >/dev/null

ARTIFACT="$(artifact_path)"
[[ -f "$ARTIFACT" ]] || fail "Missing runtime artifact: $ARTIFACT"

log "Installing launcher and runtime into isolated paths..."
HOME="$TEST_HOME" \
PATH="$TEST_BIN:/usr/bin:/bin" \
FOOLERY_INSTALL_ROOT="$TEST_INSTALL_ROOT" \
FOOLERY_APP_DIR="$TEST_APP_DIR" \
FOOLERY_BIN_DIR="$TEST_BIN" \
FOOLERY_STATE_DIR="$TEST_STATE_DIR" \
FOOLERY_LAUNCHER_PATH="$TEST_LAUNCHER" \
FOOLERY_ARTIFACT_URL="file://$ARTIFACT" \
FOOLERY_NO_BROWSER=1 \
bash "$ROOT_DIR/scripts/install.sh" >/dev/null

[[ -x "$TEST_LAUNCHER" ]] || fail "Missing installed launcher: $TEST_LAUNCHER"

log "Running installed foolery setup through a PTY..."
HOME="$TEST_HOME" \
PATH="$TEST_BIN:/usr/bin:/bin" \
FOOLERY_SETUP_URL="file://$ROOT_DIR/scripts/setup.sh" \
run_setup_with_tty \
  "$TEST_LAUNCHER setup" \
  $'n\ny\n'

[[ -f "$SETTINGS_FILE" ]] || fail "Missing settings file: $SETTINGS_FILE"
assert_contains "[agents.copilot]" "$SETTINGS_FILE"
assert_contains 'command = "copilot"' "$SETTINGS_FILE"
assert_contains 'model = "claude-sonnet-4.5"' "$SETTINGS_FILE"
assert_contains 'take = "copilot"' "$SETTINGS_FILE"
assert_contains 'scene = "copilot"' "$SETTINGS_FILE"
assert_contains 'breakdown = "copilot"' "$SETTINGS_FILE"

log "PASS: installed launcher configured Copilot from isolated setup."
