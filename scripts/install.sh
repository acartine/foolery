#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${FOOLERY_INSTALL_ROOT:-$HOME/.local/share/foolery}"
APP_DIR="${FOOLERY_APP_DIR:-$INSTALL_ROOT/runtime}"
BIN_DIR="${FOOLERY_BIN_DIR:-$HOME/.local/bin}"
STATE_DIR="${FOOLERY_STATE_DIR:-$HOME/.local/state/foolery}"
LAUNCHER_PATH="$BIN_DIR/foolery"

RELEASE_OWNER="${FOOLERY_RELEASE_OWNER:-acartine}"
RELEASE_REPO="${FOOLERY_RELEASE_REPO:-foolery}"
RELEASE_TAG="${FOOLERY_RELEASE_TAG:-latest}"
ASSET_BASENAME="${FOOLERY_ASSET_BASENAME:-foolery-runtime}"
ARTIFACT_URL="${FOOLERY_ARTIFACT_URL:-}"

log() {
  printf '[foolery-install] %s\n' "$*"
}

warn() {
  printf '[foolery-install] WARNING: %s\n' "$*" >&2
}

fail() {
  printf '[foolery-install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

normalize_os() {
  case "$1" in
    Darwin) printf 'darwin\n' ;;
    Linux) printf 'linux\n' ;;
    *) fail "Unsupported OS: $1" ;;
  esac
}

normalize_arch() {
  case "$1" in
    x86_64|amd64) printf 'x64\n' ;;
    arm64|aarch64) printf 'arm64\n' ;;
    *) fail "Unsupported architecture: $1" ;;
  esac
}

artifact_name() {
  local os arch
  os="$(normalize_os "$(uname -s)")"
  arch="$(normalize_arch "$(uname -m)")"
  printf '%s-%s-%s.tar.gz\n' "$ASSET_BASENAME" "$os" "$arch"
}

download_url() {
  local asset
  asset="$(artifact_name)"

  if [[ -n "$ARTIFACT_URL" ]]; then
    printf '%s\n' "$ARTIFACT_URL"
    return 0
  fi

  if [[ "$RELEASE_TAG" == "latest" ]]; then
    printf 'https://github.com/%s/%s/releases/latest/download/%s\n' "$RELEASE_OWNER" "$RELEASE_REPO" "$asset"
    return 0
  fi

  printf 'https://github.com/%s/%s/releases/download/%s/%s\n' "$RELEASE_OWNER" "$RELEASE_REPO" "$RELEASE_TAG" "$asset"
}

write_launcher() {
  local launcher_dir tmp_launcher
  launcher_dir="$(dirname "$LAUNCHER_PATH")"
  tmp_launcher="$(mktemp "$launcher_dir/foolery-launcher.XXXXXX")"

  cat >"$tmp_launcher" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="\${FOOLERY_APP_DIR:-$APP_DIR}"
INSTALL_ROOT="\${FOOLERY_INSTALL_ROOT:-$INSTALL_ROOT}"
BIN_DIR="\${FOOLERY_BIN_DIR:-$BIN_DIR}"
LAUNCHER_PATH="\${FOOLERY_LAUNCHER_PATH:-$LAUNCHER_PATH}"
STATE_DIR="\${FOOLERY_STATE_DIR:-$STATE_DIR}"
HOST="\${FOOLERY_HOST:-127.0.0.1}"
PORT="\${FOOLERY_PORT:-3210}"
NEXT_BIN="\${FOOLERY_NEXT_BIN:-\$APP_DIR/node_modules/next/dist/bin/next}"
LOG_DIR="\${FOOLERY_LOG_DIR:-\$STATE_DIR/logs}"
PID_FILE="\${FOOLERY_PID_FILE:-\$STATE_DIR/foolery.pid}"
STDOUT_LOG="\${FOOLERY_STDOUT_LOG:-\$LOG_DIR/stdout.log}"
STDERR_LOG="\${FOOLERY_STDERR_LOG:-\$LOG_DIR/stderr.log}"
NO_BROWSER="\${FOOLERY_NO_BROWSER:-0}"
WAIT_FOR_READY="\${FOOLERY_WAIT_FOR_READY:-0}"
URL="\${FOOLERY_URL:-http://\$HOST:\$PORT}"
RELEASE_OWNER="\${FOOLERY_RELEASE_OWNER:-$RELEASE_OWNER}"
RELEASE_REPO="\${FOOLERY_RELEASE_REPO:-$RELEASE_REPO}"
RELEASE_TAG="\${FOOLERY_RELEASE_TAG:-latest}"
UPDATE_CHECK_ENABLED="\${FOOLERY_UPDATE_CHECK:-1}"
UPDATE_CHECK_INTERVAL_SECONDS="\${FOOLERY_UPDATE_CHECK_INTERVAL_SECONDS:-21600}"
UPDATE_CHECK_FILE="\${FOOLERY_UPDATE_CHECK_FILE:-\$STATE_DIR/update-check.cache}"
PROMPT_TEMPLATE_FILE="\${FOOLERY_PROMPT_TEMPLATE_FILE:-\$APP_DIR/PROMPT.md}"
PROMPT_MARKER="FOOLERY_GUIDANCE_PROMPT_START"

if [[ "\$HOST" == "0.0.0.0" && -z "\${FOOLERY_URL:-}" ]]; then
  URL="http://127.0.0.1:\$PORT"
fi

if [[ ! "\$UPDATE_CHECK_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  UPDATE_CHECK_INTERVAL_SECONDS=21600
fi

log() {
  printf '[foolery] %s\n' "\$*"
}

fail() {
  printf '[foolery] ERROR: %s\n' "\$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "\$1" >/dev/null 2>&1; then
    fail "Missing required command: \$1"
  fi
}

ensure_runtime() {
  if [[ ! -d "\$APP_DIR" ]]; then
    fail "Runtime not found at \$APP_DIR. Re-run installer."
  fi

  if [[ ! -f "\$APP_DIR/package.json" || ! -f "\$APP_DIR/.next/BUILD_ID" || ! -d "\$APP_DIR/node_modules" || ! -f "\$NEXT_BIN" ]]; then
    fail "Runtime bundle is incomplete. Re-run installer to refresh files."
  fi
}

read_pid() {
  if [[ ! -f "\$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="\$(tr -d '[:space:]' <"\$PID_FILE")"
  if [[ ! "\$pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s\n' "\$pid"
}

is_running() {
  local pid
  if ! pid="\$(read_pid)"; then
    return 1
  fi

  kill -0 "\$pid" >/dev/null 2>&1
}

clear_stale_pid() {
  if [[ -f "\$PID_FILE" ]] && ! is_running; then
    rm -f "\$PID_FILE"
  fi
}

read_installed_version() {
  local version
  if [[ -f "\$APP_DIR/RELEASE_VERSION" ]]; then
    version="\$(tr -d '[:space:]' <"\$APP_DIR/RELEASE_VERSION")"
    if [[ -n "\$version" ]]; then
      printf '%s\n' "\$version"
      return 0
    fi
  fi

  if [[ ! -f "\$APP_DIR/package.json" ]]; then
    return 1
  fi

  version="\$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*$/\1/p' "\$APP_DIR/package.json" | head -n 1)"
  if [[ -z "\$version" ]]; then
    return 1
  fi

  printf '%s\n' "\$version"
}

semver_triplet() {
  local raw="\$1"
  raw="\${raw#v}"
  raw="\${raw%%-*}"
  raw="\${raw%%+*}"

  local major minor patch
  IFS='.' read -r major minor patch _ <<<"\$raw"

  if [[ ! "\$major" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if [[ -n "\${minor:-}" && ! "\$minor" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if [[ -n "\${patch:-}" && ! "\$patch" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s %s %s\n' "\$major" "\${minor:-0}" "\${patch:-0}"
}

is_newer_version() {
  local installed="\$1"
  local latest="\$2"
  local installed_triplet latest_triplet

  if ! installed_triplet="\$(semver_triplet "\$installed")"; then
    return 1
  fi
  if ! latest_triplet="\$(semver_triplet "\$latest")"; then
    return 1
  fi

  local i_major i_minor i_patch
  local l_major l_minor l_patch
  read -r i_major i_minor i_patch <<<"\$installed_triplet"
  read -r l_major l_minor l_patch <<<"\$latest_triplet"

  if ((l_major > i_major)); then
    return 0
  fi
  if ((l_major < i_major)); then
    return 1
  fi
  if ((l_minor > i_minor)); then
    return 0
  fi
  if ((l_minor < i_minor)); then
    return 1
  fi

  ((l_patch > i_patch))
}

read_cached_latest_tag() {
  if [[ ! -f "\$UPDATE_CHECK_FILE" ]]; then
    return 1
  fi

  local checked_at latest_tag now
  checked_at="\$(sed -n '1p' "\$UPDATE_CHECK_FILE" 2>/dev/null || true)"
  latest_tag="\$(sed -n '2p' "\$UPDATE_CHECK_FILE" 2>/dev/null || true)"

  if [[ ! "\$checked_at" =~ ^[0-9]+$ ]] || [[ -z "\$latest_tag" ]]; then
    return 1
  fi

  now="\$(date +%s)"
  if ((now - checked_at > UPDATE_CHECK_INTERVAL_SECONDS)); then
    return 1
  fi

  printf '%s\n' "\$latest_tag"
}

write_cached_latest_tag() {
  local latest_tag="\$1"
  local now
  now="\$(date +%s)"
  mkdir -p "\$STATE_DIR" >/dev/null 2>&1 || true
  printf '%s\n%s\n' "\$now" "\$latest_tag" >"\$UPDATE_CHECK_FILE" 2>/dev/null || true
}

fetch_latest_release_tag() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi

  local api_url payload latest_tag
  api_url="https://api.github.com/repos/\$RELEASE_OWNER/\$RELEASE_REPO/releases/latest"
  payload="\$(curl --silent --show-error --location --max-time 2 --retry 1 "\$api_url" 2>/dev/null || true)"
  latest_tag="\$(printf '%s\n' "\$payload" | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)"

  if [[ -z "\$latest_tag" ]]; then
    return 1
  fi

  printf '%s\n' "\$latest_tag"
}

maybe_print_update_banner() {
  if [[ "\$UPDATE_CHECK_ENABLED" != "1" ]]; then
    return 0
  fi

  local installed_version latest_tag
  if ! installed_version="\$(read_installed_version)"; then
    return 0
  fi

  if ! latest_tag="\$(read_cached_latest_tag)"; then
    if ! latest_tag="\$(fetch_latest_release_tag)"; then
      return 0
    fi
    write_cached_latest_tag "\$latest_tag"
  fi

  if is_newer_version "\$installed_version" "\$latest_tag"; then
    log "------------------------------------------------------------"
    log "New Foolery version available: \${latest_tag} (installed \${installed_version})"
    log "Upgrade: curl -fsSL https://raw.githubusercontent.com/\$RELEASE_OWNER/\$RELEASE_REPO/main/scripts/install.sh | bash"
    log "------------------------------------------------------------"
  fi
}

macos_browser_has_url_open() {
  if [[ "\$(uname -s)" != "Darwin" ]]; then
    return 1
  fi
  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v pgrep >/dev/null 2>&1; then
    return 1
  fi

  local app result
  local -a browsers=("Safari" "Google Chrome" "Chromium" "Brave Browser" "Arc" "Microsoft Edge")
  for app in "\${browsers[@]}"; do
    if ! pgrep -x "\$app" >/dev/null 2>&1; then
      continue
    fi

    result="\$(osascript - "\$app" "\$URL" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set appName to item 1 of argv
  set targetPrefix to item 2 of argv
  try
    if application appName is running then
      tell application appName
        repeat with w in windows
          repeat with t in tabs of w
            try
              set tabURL to (URL of t) as text
              if tabURL starts with targetPrefix then
                return "1"
              end if
            end try
          end repeat
        end repeat
      end tell
    end if
  end try
  return "0"
end run
APPLESCRIPT
)"
    if [[ "\$result" == "1" ]]; then
      return 0
    fi
  done

  return 1
}

browser_has_url_open() {
  macos_browser_has_url_open
}

open_browser() {
  if [[ "\$NO_BROWSER" == "1" ]]; then
    log "Skipping browser open (FOOLERY_NO_BROWSER=1). URL: \$URL"
    return 0
  fi

  if browser_has_url_open; then
    log "Foolery is already open in a browser at \$URL"
    return 0
  fi

  if [[ "\$(uname -s)" == "Darwin" ]] && [[ -x "/usr/bin/open" ]]; then
    /usr/bin/open "\$URL" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v open >/dev/null 2>&1; then
    command open "\$URL" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "\$URL" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "\$URL" >/dev/null 2>&1 || true
    return 0
  fi

  log "No browser opener found. Open this URL manually: \$URL"
}

wait_for_startup() {
  local pid="\$1"
  local attempts=30

  if ! command -v curl >/dev/null 2>&1; then
    sleep 2
    return 0
  fi

  while ((attempts > 0)); do
    if ! kill -0 "\$pid" >/dev/null 2>&1; then
      return 1
    fi

    if curl --silent --show-error --max-time 1 "\$URL" >/dev/null 2>&1; then
      return 0
    fi

    attempts=\$((attempts - 1))
    sleep 1
  done

  return 0
}

start_cmd() {
  require_cmd node
  ensure_runtime
  mkdir -p "\$STATE_DIR" "\$LOG_DIR"
  clear_stale_pid

  if is_running; then
    local pid
    pid="\$(read_pid)"
    log "Already running (pid \$pid) at \$URL"
    open_browser
    return 0
  fi

  log "Starting Foolery on \$URL"
  (
    cd "\$APP_DIR"
    nohup env NODE_ENV=production node "\$NEXT_BIN" start --hostname "\$HOST" --port "\$PORT" >>"\$STDOUT_LOG" 2>>"\$STDERR_LOG" < /dev/null &
    echo \$! >"\$PID_FILE"
  )

  local pid
  if ! pid="\$(read_pid)"; then
    fail "Failed to capture process ID for started server."
  fi

  # Detect immediate startup failure without blocking normal background startup.
  sleep 0.2
  if ! kill -0 "\$pid" >/dev/null 2>&1; then
    rm -f "\$PID_FILE"
    fail "Server exited during startup. Check logs: \$STDERR_LOG"
  fi

  log "Started (pid \$pid)"
  log "stdout: \$STDOUT_LOG"
  log "stderr: \$STDERR_LOG"
  open_browser

  if [[ "\$WAIT_FOR_READY" == "1" ]]; then
    if ! wait_for_startup "\$pid"; then
      rm -f "\$PID_FILE"
      fail "Server exited during startup. Check logs: \$STDERR_LOG"
    fi
  fi
}

stop_cmd() {
  clear_stale_pid
  if ! is_running; then
    log "Foolery is not running."
    return 0
  fi

  local pid
  pid="\$(read_pid)"
  log "Stopping Foolery (pid \$pid)"
  kill "\$pid" >/dev/null 2>&1 || true

  local attempts=20
  while ((attempts > 0)); do
    if ! kill -0 "\$pid" >/dev/null 2>&1; then
      rm -f "\$PID_FILE"
      log "Stopped."
      return 0
    fi
    attempts=\$((attempts - 1))
    sleep 1
  done

  log "Process did not stop gracefully; forcing kill."
  kill -9 "\$pid" >/dev/null 2>&1 || true
  rm -f "\$PID_FILE"
  log "Stopped."
}

status_cmd() {
  clear_stale_pid
  if is_running; then
    local pid
    pid="\$(read_pid)"
    log "Running (pid \$pid) at \$URL"
    log "stdout: \$STDOUT_LOG"
    log "stderr: \$STDERR_LOG"
    return 0
  fi

  log "Not running."
}

open_cmd() {
  clear_stale_pid
  if is_running; then
    open_browser
    return 0
  fi

  log "Foolery is not running. Starting it first."
  start_cmd "\$@"
}

update_cmd() {
  require_cmd bash
  require_cmd curl

  local install_url
  install_url="https://raw.githubusercontent.com/\$RELEASE_OWNER/\$RELEASE_REPO/main/scripts/install.sh"

  log "Updating Foolery runtime from \$RELEASE_OWNER/\$RELEASE_REPO (\$RELEASE_TAG)..."
  if ! curl --fail --location --silent --show-error "\$install_url" | \
    env \
      FOOLERY_INSTALL_ROOT="\$INSTALL_ROOT" \
      FOOLERY_APP_DIR="\$APP_DIR" \
      FOOLERY_BIN_DIR="\$BIN_DIR" \
      FOOLERY_STATE_DIR="\$STATE_DIR" \
      FOOLERY_LAUNCHER_PATH="\$LAUNCHER_PATH" \
      FOOLERY_RELEASE_OWNER="\$RELEASE_OWNER" \
      FOOLERY_RELEASE_REPO="\$RELEASE_REPO" \
      FOOLERY_RELEASE_TAG="\$RELEASE_TAG" \
      bash; then
    fail "Update failed."
  fi

  rm -f "\$UPDATE_CHECK_FILE" >/dev/null 2>&1 || true
  log "Update complete."
}

uninstall_cmd() {
  stop_cmd || true

  local tmp_script
  tmp_script="\$(mktemp "\${TMPDIR:-/tmp}/foolery-uninstall.XXXXXX")"

  cat >"\$tmp_script" <<'UNINSTALL'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="\$1"
STATE_DIR="\$2"
LAUNCHER_PATH="\$3"
BIN_DIR="\$4"
INSTALL_ROOT="\$5"

log() {
  printf '[foolery-uninstall] %s\n' "\$*"
}

remove_path() {
  local path="\$1"
  if [[ -z "\$path" || "\$path" == "/" ]]; then
    log "Skipping unsafe path: \$path"
    return 0
  fi

  if [[ -e "\$path" ]]; then
    rm -rf "\$path"
    log "Removed \$path"
  fi
}

remove_if_empty() {
  local path="\$1"
  if [[ -d "\$path" ]] && [[ -z "\$(ls -A "\$path" 2>/dev/null)" ]]; then
    rmdir "\$path" >/dev/null 2>&1 || true
  fi
}

remove_path "\$APP_DIR"
remove_path "\$STATE_DIR"
remove_path "\$LAUNCHER_PATH"

remove_if_empty "\$INSTALL_ROOT"
remove_if_empty "\$BIN_DIR"

  log "Uninstall complete."
UNINSTALL

  if ! bash -n "\$tmp_script"; then
    rm -f "\$tmp_script"
    fail "Generated uninstall helper failed syntax validation."
  fi

  chmod +x "\$tmp_script"
  "\$tmp_script" "\$APP_DIR" "\$STATE_DIR" "\$LAUNCHER_PATH" "\$BIN_DIR" "\$INSTALL_ROOT"
  rm -f "\$tmp_script"
}

setup_cmd() {
  require_cmd bash
  require_cmd curl

  local setup_url
  setup_url="https://raw.githubusercontent.com/\$RELEASE_OWNER/\$RELEASE_REPO/main/scripts/setup.sh"

  local tmp_setup
  tmp_setup="\$(mktemp "\${TMPDIR:-/tmp}/foolery-setup.XXXXXX")"
  if ! curl --fail --location --silent --show-error "\$setup_url" -o "\$tmp_setup"; then
    rm -f "\$tmp_setup"
    fail "Failed to download setup script."
  fi

  # shellcheck disable=SC1090
  source "\$tmp_setup"
  rm -f "\$tmp_setup"
  foolery_setup "\$@"
}

append_guidance_prompt() {
  local target_file="\$1"

  if grep -Fq "\$PROMPT_MARKER" "\$target_file" 2>/dev/null; then
    return 2
  fi

  printf '\n\n' >>"\$target_file"
  cat "\$PROMPT_TEMPLATE_FILE" >>"\$target_file"
  printf '\n' >>"\$target_file"
  return 0
}

prompt_cmd() {
  local cwd target_file
  local found=0 updated=0 skipped=0
  cwd="\$(pwd)"

  if [[ ! -f "\$PROMPT_TEMPLATE_FILE" ]]; then
    fail "Guidance prompt template not found at \$PROMPT_TEMPLATE_FILE. Run foolery update."
  fi

  for target_file in "\$cwd/AGENTS.md" "\$cwd/CLAUDE.md"; do
    if [[ ! -f "\$target_file" ]]; then
      continue
    fi

    found=\$((found + 1))
    if append_guidance_prompt "\$target_file"; then
      log "Updated: \$target_file"
      updated=\$((updated + 1))
    else
      local code="\$?"
      if [[ "\$code" -eq 2 ]]; then
        log "Already contains Foolery guidance: \$target_file"
        skipped=\$((skipped + 1))
      else
        fail "Failed updating \$target_file"
      fi
    fi
  done

  if [[ "\$found" -eq 0 ]]; then
    fail "No AGENTS.md or CLAUDE.md found in \$cwd."
  fi

  log "Prompt update complete: \$updated updated, \$skipped already up to date."
}

doctor_cmd() {
  local fix=0
  while [[ \$# -gt 0 ]]; do
    case "\$1" in
      --fix) fix=1; shift ;;
      *) shift ;;
    esac
  done

  # Ensure the server is running so we can hit the API
  clear_stale_pid
  if ! is_running; then
    fail "Foolery is not running. Start it first: foolery start"
  fi

  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required for foolery doctor."
  fi

  local method="GET"
  if [[ "\$fix" -eq 1 ]]; then
    method="POST"
  fi

  local response
  response="\$(curl --silent --show-error --max-time 60 -X "\$method" "\$URL/api/doctor" 2>&1)" || {
    fail "Failed to reach Foolery API at \$URL/api/doctor"
  }

  # Formatted output requires jq; fall back to raw JSON
  if ! command -v jq >/dev/null 2>&1; then
    printf '%s\n' "\$response"
    return
  fi

  local GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m' CYAN='\033[0;36m' BOLD='\033[1m' RESET='\033[0m'
  local CHECK_PASS="\${GREEN}✔\${RESET}" CHECK_FAIL="\${RED}✘\${RESET}" CHECK_WARN="\${YELLOW}⚠\${RESET}"

  printf "\n\${BOLD}Foolery Doctor\${RESET}\n\n"

  if [[ "\$fix" -eq 1 ]]; then
    # Fix mode — show fix results
    local attempted succeeded failed
    attempted=\$(printf '%s' "\$response" | jq -r '.data.summary.attempted // 0')
    succeeded=\$(printf '%s' "\$response" | jq -r '.data.summary.succeeded // 0')
    failed=\$(printf '%s' "\$response" | jq -r '.data.summary.failed // 0')

    if [[ "\$attempted" -eq 0 ]]; then
      printf "  \${CHECK_PASS}  Nothing to fix\n"
    else
      printf '%s' "\$response" | jq -r '.data.fixes[] | "\(.success)|\(.check)|\(.message)"' | while IFS='|' read -r success check msg; do
        if [[ "\$success" == "true" ]]; then
          printf "  \${CHECK_PASS}  \${GREEN}%s\${RESET}  %s\n" "\$check" "\$msg"
        else
          printf "  \${CHECK_FAIL}  \${RED}%s\${RESET}  %s\n" "\$check" "\$msg"
        fi
      done
      printf "\n  Fixes: \${GREEN}%s succeeded\${RESET}, \${RED}%s failed\${RESET} (of %s)\n" "\$succeeded" "\$failed" "\$attempted"
    fi
  else
    # Diagnose mode — group by check, show summary counts
    local errors warnings infos fixable
    errors=\$(printf '%s' "\$response" | jq -r '.data.summary.errors // 0')
    warnings=\$(printf '%s' "\$response" | jq -r '.data.summary.warnings // 0')
    infos=\$(printf '%s' "\$response" | jq -r '.data.summary.infos // 0')
    fixable=\$(printf '%s' "\$response" | jq -r '.data.summary.fixable // 0')

    # Group diagnostics by severity for cleaner output
    local has_items=0

    # Errors first
    local error_count
    error_count=\$(printf '%s' "\$response" | jq '[.data.diagnostics[] | select(.severity == "error")] | length')
    if [[ "\$error_count" -gt 0 ]]; then
      has_items=1
      local error_checks
      error_checks=\$(printf '%s' "\$response" | jq -r '[.data.diagnostics[] | select(.severity == "error") | .check] | unique | .[]')
      while IFS= read -r check_name; do
        local count
        count=\$(printf '%s' "\$response" | jq --arg c "\$check_name" '[.data.diagnostics[] | select(.severity == "error" and .check == \$c)] | length')
        if [[ "\$count" -gt 3 ]]; then
          printf "  \${CHECK_FAIL}  \${RED}%s\${RESET}  %s issues found\n" "\$check_name" "\$count"
        else
          printf '%s' "\$response" | jq -r --arg c "\$check_name" '.data.diagnostics[] | select(.severity == "error" and .check == \$c) | .message' | while IFS= read -r msg; do
            printf "  \${CHECK_FAIL}  %s\n" "\$msg"
          done
        fi
      done <<< "\$error_checks"
    fi

    # Warnings
    local warn_count
    warn_count=\$(printf '%s' "\$response" | jq '[.data.diagnostics[] | select(.severity == "warning")] | length')
    if [[ "\$warn_count" -gt 0 ]]; then
      has_items=1
      local warn_checks
      warn_checks=\$(printf '%s' "\$response" | jq -r '[.data.diagnostics[] | select(.severity == "warning") | .check] | unique | .[]')
      while IFS= read -r check_name; do
        local count
        count=\$(printf '%s' "\$response" | jq --arg c "\$check_name" '[.data.diagnostics[] | select(.severity == "warning" and .check == \$c)] | length')
        if [[ "\$count" -gt 3 ]]; then
          printf "  \${CHECK_WARN}  \${YELLOW}%s\${RESET}  %s issues found\n" "\$check_name" "\$count"
        else
          printf '%s' "\$response" | jq -r --arg c "\$check_name" '.data.diagnostics[] | select(.severity == "warning" and .check == \$c) | .message' | while IFS= read -r msg; do
            printf "  \${CHECK_WARN}  %s\n" "\$msg"
          done
        fi
      done <<< "\$warn_checks"
    fi

    # Info (healthy checks)
    local info_count
    info_count=\$(printf '%s' "\$response" | jq '[.data.diagnostics[] | select(.severity == "info")] | length')
    if [[ "\$info_count" -gt 0 ]]; then
      has_items=1
      printf '%s' "\$response" | jq -r '.data.diagnostics[] | select(.severity == "info") | .message' | while IFS= read -r msg; do
        printf "  \${CHECK_PASS}  %s\n" "\$msg"
      done
    fi

    if [[ "\$has_items" -eq 0 ]]; then
      printf "  \${CHECK_PASS}  All checks passed\n"
    fi

    # Summary line
    printf "\n"
    if [[ "\$errors" -gt 0 ]] || [[ "\$warnings" -gt 0 ]]; then
      printf "  Summary: \${RED}%s errors\${RESET}, \${YELLOW}%s warnings\${RESET}, \${GREEN}%s ok\${RESET}" "\$errors" "\$warnings" "\$infos"
      if [[ "\$fixable" -gt 0 ]]; then
        printf " (\${CYAN}%s auto-fixable\${RESET} — run \${BOLD}foolery doctor --fix\${RESET})" "\$fixable"
      fi
      printf "\n"
    else
      printf "  \${GREEN}\${BOLD}All clear!\${RESET} %s checks passed.\n" "\$infos"
    fi
  fi
  printf "\n"
}

usage() {
  cat <<USAGE
Usage: foolery <command>

Commands:
  start     Start Foolery in the background and open browser
  open      Open Foolery in your browser (skips if already open)
  setup     Configure repos and agents interactively
  prompt    Append Foolery guidance prompt to AGENTS.md/CLAUDE.md
  update    Download and install the latest Foolery runtime
  stop      Stop the background Foolery process
  restart   Restart Foolery
  status    Show process/log status
  doctor    Run diagnostics (--fix to auto-fix issues)
  uninstall Remove Foolery runtime, logs/state, and launcher
  help      Show this help
USAGE
}

main() {
  local cmd="\${1:-open}"
  shift || true

  maybe_print_update_banner

  case "\$cmd" in
    start)
      start_cmd "\$@"
      ;;
    open)
      open_cmd "\$@"
      ;;
    setup)
      setup_cmd "\$@"
      ;;
    prompt)
      prompt_cmd "\$@"
      ;;
    update)
      update_cmd "\$@"
      ;;
    stop)
      stop_cmd "\$@"
      ;;
    restart)
      stop_cmd "\$@"
      start_cmd "\$@"
      ;;
    status)
      status_cmd "\$@"
      ;;
    doctor)
      doctor_cmd "\$@"
      ;;
    uninstall)
      uninstall_cmd "\$@"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage
      fail "Unknown command: \$cmd"
      ;;
  esac
}

main "\$@"
LAUNCHER

  chmod +x "$tmp_launcher"
  if ! bash -n "$tmp_launcher"; then
    rm -f "$tmp_launcher"
    fail "Generated launcher failed syntax validation."
  fi

  mv "$tmp_launcher" "$LAUNCHER_PATH"
}

install_runtime() {
  local asset archive_url tmp_dir archive_path extract_dir runtime_source runtime_target

  asset="$(artifact_name)"
  archive_url="$(download_url)"
  runtime_target="$APP_DIR"

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/foolery-install.XXXXXX")"
  archive_path="$tmp_dir/$asset"
  extract_dir="$tmp_dir/extract"
  mkdir -p "$extract_dir"

  log "Downloading runtime artifact: $asset"
  log "Source: $archive_url"
  if ! curl --fail --location --silent --show-error --retry 3 --retry-delay 1 --output "$archive_path" "$archive_url"; then
    fail "Failed to download release artifact. Verify release/tag exists and includes $asset"
  fi

  tar -xzf "$archive_path" -C "$extract_dir"
  runtime_source="$extract_dir/foolery-runtime"

  if [[ ! -d "$runtime_source" ]]; then
    fail "Downloaded artifact is missing expected folder: foolery-runtime"
  fi

  if [[ ! -f "$runtime_source/package.json" || ! -f "$runtime_source/.next/BUILD_ID" || ! -d "$runtime_source/node_modules" ]]; then
    fail "Downloaded artifact is missing required runtime files"
  fi

  local tmp_runtime
  tmp_runtime="${runtime_target}.new.$$"
  rm -rf "$tmp_runtime"
  cp -R "$runtime_source" "$tmp_runtime"
  rm -rf "$runtime_target"
  mv "$tmp_runtime" "$runtime_target"

  rm -rf "$tmp_dir"
}

main() {
  require_cmd curl
  require_cmd tar
  require_cmd node

  if ! command -v bd >/dev/null 2>&1; then
    warn "bd CLI is not on PATH. Foolery relies on bd at runtime."
  fi

  mkdir -p "$INSTALL_ROOT" "$BIN_DIR" "$STATE_DIR"

  install_runtime

  log "Writing launcher to $LAUNCHER_PATH"
  write_launcher

  if [[ -f "$STATE_DIR/foolery.pid" ]]; then
    local existing_pid
    existing_pid="$(tr -d '[:space:]' <"$STATE_DIR/foolery.pid" || true)"
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      warn "Foolery is already running (pid $existing_pid). Run 'foolery restart' to pick up the new runtime."
    fi
  fi

  log "Install complete"
  log "Commands: foolery start | foolery setup | foolery prompt | foolery update | foolery stop | foolery restart | foolery status | foolery uninstall"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      log "Launcher is on PATH."
      ;;
    *)
      log "Add $BIN_DIR to PATH:"
      log "  export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac

  log "Get started: foolery"
  log "Log files default to: $STATE_DIR/logs"
  log ""
  log "Configure repos and agents: foolery setup"
}

main "$@"
