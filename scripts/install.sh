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

usage() {
  cat <<USAGE
Usage: foolery <command>

Commands:
  start     Start Foolery in the background and open browser
  open      Open Foolery in your browser (skips if already open)
  update    Download and install the latest Foolery runtime
  stop      Stop the background Foolery process
  restart   Restart Foolery
  status    Show process/log status
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

# ---------------------------------------------------------------------------
# Interactive repo-discovery wizard (post-install)
# ---------------------------------------------------------------------------

REGISTRY_DIR="${HOME}/.config/foolery"
REGISTRY_FILE="${REGISTRY_DIR}/registry.json"

confirm_prompt() {
  local prompt="$1" default="${2:-y}"
  local answer
  read -r -p "$prompt" answer </dev/tty || answer=""
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

read_registry_paths() {
  if [[ ! -f "$REGISTRY_FILE" ]]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.repos[]?.path // empty' "$REGISTRY_FILE" 2>/dev/null || true
  else
    # Use tr to split entries onto separate lines, then extract paths
    tr '{' '\n' <"$REGISTRY_FILE" 2>/dev/null \
      | sed -nE 's/.*"path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
      || true
  fi
}

_REGISTRY_CACHE=""
_REGISTRY_CACHE_VALID=0

refresh_registry_cache() {
  _REGISTRY_CACHE="$(read_registry_paths)"
  _REGISTRY_CACHE_VALID=1
}

invalidate_registry_cache() {
  _REGISTRY_CACHE_VALID=0
}

append_to_registry_cache() {
  local path="$1"
  if [[ "$_REGISTRY_CACHE_VALID" -ne 1 ]]; then
    refresh_registry_cache
  fi
  if [[ -z "$_REGISTRY_CACHE" ]]; then
    _REGISTRY_CACHE="$path"
  else
    _REGISTRY_CACHE="$(printf '%s\n%s' "$_REGISTRY_CACHE" "$path")"
  fi
}

is_path_registered() {
  local target="$1"
  if [[ "$_REGISTRY_CACHE_VALID" -ne 1 ]]; then
    refresh_registry_cache
  fi
  if [[ -z "$_REGISTRY_CACHE" ]]; then
    return 1
  fi
  printf '%s\n' "$_REGISTRY_CACHE" | grep -qxF "$target"
}

show_mounted_repos() {
  local mounted
  mounted="$(read_registry_paths)"
  if [[ -z "$mounted" ]]; then
    return 1
  fi
  printf '\nThe following clones are already mounted:\n'
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    printf '  - %s (%s)\n' "$p" "$(basename "$p")"
  done <<EOF
$mounted
EOF
  return 0
}

write_registry_entry() {
  local repo_path="$1"
  local repo_name now
  repo_name="$(basename "$repo_path")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%s)"
  mkdir -p "$REGISTRY_DIR"

  if command -v jq >/dev/null 2>&1; then
    write_registry_entry_jq "$repo_path" "$repo_name" "$now"
  else
    write_registry_entry_sed "$repo_path" "$repo_name" "$now"
  fi
  append_to_registry_cache "$repo_path"
}

write_registry_entry_jq() {
  local repo_path="$1" repo_name="$2" now="$3"
  local tmp_file="${REGISTRY_FILE}.tmp.$$"

  if [[ -f "$REGISTRY_FILE" ]]; then
    jq --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" \
      '.repos += [{"path": $p, "name": $n, "addedAt": $d}]' \
      "$REGISTRY_FILE" >"$tmp_file" 2>/dev/null
  else
    jq -n --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" \
      '{"repos": [{"path": $p, "name": $n, "addedAt": $d}]}' \
      >"$tmp_file" 2>/dev/null
  fi
  mv "$tmp_file" "$REGISTRY_FILE"
}

escape_json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

write_registry_entry_sed() {
  local repo_path="$1" repo_name="$2" now="$3"
  local safe_path safe_name entry
  safe_path="$(escape_json_string "$repo_path")"
  safe_name="$(escape_json_string "$repo_name")"
  entry="$(printf '{"path": "%s", "name": "%s", "addedAt": "%s"}' "$safe_path" "$safe_name" "$now")"

  if [[ ! -f "$REGISTRY_FILE" ]]; then
    printf '{"repos": [%s]}\n' "$entry" >"$REGISTRY_FILE"
    return 0
  fi

  # Read existing content, strip newlines for single-line manipulation
  local content
  content="$(tr -d '\n' <"$REGISTRY_FILE")"

  # Build new content by stripping the trailing ]} and appending the new entry
  local prefix
  prefix="${content%\]*}"
  if [[ "$prefix" == "$content" ]]; then
    # Malformed file -- overwrite
    printf '{"repos": [%s]}\n' "$entry" >"$REGISTRY_FILE"
    return 0
  fi
  printf '%s,%s]}\n' "$prefix" "$entry" >"$REGISTRY_FILE"
}

scan_and_mount_repos() {
  local scan_dir="$1"
  if [[ ! -d "$scan_dir" ]]; then
    log "Directory does not exist: $scan_dir"
    return 0
  fi

  local found_repos
  # Repos can be up to 2 levels deep; .beads/ is one level inside, so depth 3
  found_repos="$(find "$scan_dir" -maxdepth 3 -type d -name '.beads' 2>/dev/null | sort)"
  if [[ -z "$found_repos" ]]; then
    log "No repositories with .beads/ found under $scan_dir"
    return 0
  fi

  local new_count
  new_count="$(display_scan_results "$found_repos")"

  if [[ "$new_count" -eq 0 ]]; then
    log "All found repositories are already mounted."
    return 0
  fi

  mount_selected_repos "$found_repos"
}

display_scan_results() {
  local found_repos="$1" i=0 new_count=0
  printf '\nFound repositories:\n' >&2
  while IFS= read -r beads_dir; do
    [[ -z "$beads_dir" ]] && continue
    local repo_dir
    repo_dir="$(dirname "$beads_dir")"
    i=$((i + 1))
    if is_path_registered "$repo_dir"; then
      printf '  %d) %s (already mounted)\n' "$i" "$repo_dir" >&2
    else
      printf '  %d) %s\n' "$i" "$repo_dir" >&2
      new_count=$((new_count + 1))
    fi
  done <<EOF
$found_repos
EOF
  printf '%d\n' "$new_count"
}

mount_selected_repos() {
  local found_repos="$1" choice
  read -r -p "Enter numbers to mount (comma-separated, or 'all') [all]: " choice </dev/tty || choice=""
  choice="${choice:-all}"
  # Strip spaces so "1, 2" becomes "1,2"
  choice="${choice// /}"

  local i=0
  while IFS= read -r beads_dir; do
    [[ -z "$beads_dir" ]] && continue
    local repo_dir
    repo_dir="$(dirname "$beads_dir")"
    i=$((i + 1))

    if is_path_registered "$repo_dir"; then
      continue
    fi

    if [[ "$choice" == "all" ]] || printf ',%s,' ",$choice," | grep -q ",$i,"; then
      write_registry_entry "$repo_dir"
      log "Mounted: $repo_dir"
    fi
  done <<EOF
$found_repos
EOF
}

handle_manual_entry() {
  while true; do
    local repo_path
    read -r -p "Enter repository path (or empty to finish): " repo_path </dev/tty || break
    if [[ -z "$repo_path" ]]; then
      break
    fi

    # Expand ~ to HOME
    case "$repo_path" in
      "~"*) repo_path="${HOME}${repo_path#"~"}" ;;
    esac

    if [[ ! -d "$repo_path" ]]; then
      log "Path does not exist or is not a directory: $repo_path"
      continue
    fi
    if [[ ! -d "$repo_path/.beads" ]]; then
      log "No .beads/ directory found in: $repo_path"
      continue
    fi
    if is_path_registered "$repo_path"; then
      log "Already mounted: $repo_path"
      continue
    fi

    write_registry_entry "$repo_path"
    log "Mounted: $repo_path"
  done
}

prompt_scan_method() {
  printf '\nHow would you like to find repositories?\n'
  printf '  1) Scan a directory (default: ~, up to 2 levels deep)\n'
  printf '  2) Manually specify paths\n'
  local method
  read -r -p "Choice [1]: " method </dev/tty || method=""
  method="${method:-1}"

  case "$method" in
    1)
      local scan_dir
      read -r -p "Directory to scan [$HOME]: " scan_dir </dev/tty || scan_dir=""
      scan_dir="${scan_dir:-$HOME}"
      # Expand ~ to HOME
      case "$scan_dir" in
        "~"*) scan_dir="${HOME}${scan_dir#"~"}" ;;
      esac
      scan_and_mount_repos "$scan_dir"
      ;;
    2)
      handle_manual_entry
      ;;
    *)
      log "Invalid choice: $method"
      ;;
  esac
}

maybe_repo_wizard() {
  # Skip wizard when stdin is not a terminal (piped install)
  if [[ ! -t 0 ]]; then
    return 0
  fi

  printf '\n'
  if ! confirm_prompt "Would you like to mount existing local repo clones? (You probably do) [Y/n] " "y"; then
    return 0
  fi

  # Show already-mounted repos if any
  if show_mounted_repos; then
    if ! confirm_prompt "Are there others you'd like to add? [Y/n] " "y"; then
      return 0
    fi
  fi

  prompt_scan_method
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
  log "Commands: foolery start | foolery open | foolery update | foolery stop | foolery restart | foolery status | foolery uninstall"

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

  maybe_repo_wizard

  # Run agent discovery wizard if the helper script is available.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  if [[ -f "$script_dir/agent-wizard.sh" ]]; then
    # shellcheck source=scripts/agent-wizard.sh
    source "$script_dir/agent-wizard.sh"
    maybe_agent_wizard
  fi
}

main "$@"
