#!/usr/bin/env bash
# Manual real-CLI approval harness wrapper.
#
# This intentionally touches host CLIs and may temporarily rewrite user config.
# It is not part of the default test suite or CI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
FOOLERY_SETTINGS="${FOOLERY_SETTINGS_PATH:-$CONFIG_HOME/foolery/settings.toml}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="$(
  mktemp -d "${TMPDIR:-/tmp}/foolery-approval-harness-$TIMESTAMP.XXXXXX"
)"
MANIFEST="$BACKUP_ROOT/manifest.tsv"
KEEP_BACKUP="${FOOLERY_KEEP_APPROVAL_BACKUP:-0}"

declare -a PROTECTED_PATHS=()
declare -a PROTECTED_EXISTS=()
declare -a PROTECTED_KIND=()
declare -a PROTECTED_MODE=()
declare -a PROTECTED_CHECKSUM=()
declare -a PROTECTED_BACKUP=()

log() {
  printf '[test-cli-approvals-manual] %s\n' "$*"
}

red_banner() {
  printf '\033[1;31m%s\033[0m\n' \
    "FOOLERY APPROVAL HARNESS RESTORE FAILURE" >&2
  printf '\033[1;31m%s\033[0m\n' "$*" >&2
  printf '\033[1;31mBackup root: %s\033[0m\n' "$BACKUP_ROOT" >&2
}

stat_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

sha_cmd() {
  if command -v shasum >/dev/null 2>&1; then
    printf 'shasum'
  else
    printf 'sha256sum'
  fi
}

checksum_path() {
  local target="$1"
  local cmd
  cmd="$(sha_cmd)"
  if [[ -f "$target" ]]; then
    "$cmd" -a 256 "$target" 2>/dev/null | awk '{print $1}' \
      || "$cmd" "$target" | awk '{print $1}'
    return
  fi
  if [[ -d "$target" ]]; then
    find "$target" -type f -exec "$cmd" -a 256 {} \; 2>/dev/null \
      | LC_ALL=C sort | "$cmd" -a 256 | awk '{print $1}' \
      || find "$target" -type f -exec "$cmd" {} \; \
        | LC_ALL=C sort | "$cmd" | awk '{print $1}'
    return
  fi
  printf 'missing'
}

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

backup_item() {
  local raw_path="$1"
  local path
  path="$(absolute_path "$raw_path")"
  if [[ -z "$path" || "$path" == "/" ]]; then
    red_banner "Refusing to protect unsafe path: '$raw_path'"
    exit 1
  fi

  local index="${#PROTECTED_PATHS[@]}"
  local backup_path="$BACKUP_ROOT/item-$index"
  local existed="0"
  local kind="missing"
  local mode="-"
  local checksum="missing"

  if [[ -e "$path" || -L "$path" ]]; then
    existed="1"
    if [[ -d "$path" && ! -L "$path" ]]; then
      kind="dir"
      cp -pR "$path" "$backup_path"
    else
      kind="file"
      cp -p "$path" "$backup_path"
    fi
    mode="$(stat_mode "$path")"
    checksum="$(checksum_path "$path")"
  fi

  PROTECTED_PATHS+=("$path")
  PROTECTED_EXISTS+=("$existed")
  PROTECTED_KIND+=("$kind")
  PROTECTED_MODE+=("$mode")
  PROTECTED_CHECKSUM+=("$checksum")
  PROTECTED_BACKUP+=("$backup_path")
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$path" "$existed" "$kind" "$mode" "$checksum" "$backup_path" \
    >>"$MANIFEST"
}

restore_item() {
  local index="$1"
  local path="${PROTECTED_PATHS[$index]}"
  local existed="${PROTECTED_EXISTS[$index]}"
  local kind="${PROTECTED_KIND[$index]}"
  local mode="${PROTECTED_MODE[$index]}"
  local checksum="${PROTECTED_CHECKSUM[$index]}"
  local backup_path="${PROTECTED_BACKUP[$index]}"

  if [[ "$existed" == "0" ]]; then
    rm -rf "$path"
    if [[ -e "$path" || -L "$path" ]]; then
      red_banner "Could not remove harness-created path: $path"
      return 1
    fi
    return 0
  fi

  rm -rf "$path"
  mkdir -p "$(dirname "$path")"
  if [[ "$kind" == "dir" ]]; then
    cp -pR "$backup_path" "$path"
  else
    cp -p "$backup_path" "$path"
  fi
  chmod "$mode" "$path" >/dev/null 2>&1 || true

  local restored_checksum
  restored_checksum="$(checksum_path "$path")"
  if [[ "$restored_checksum" != "$checksum" ]]; then
    red_banner "Checksum mismatch after restoring $path"
    return 1
  fi
}

restore_all() {
  local failed="0"
  local index
  for ((index=${#PROTECTED_PATHS[@]} - 1; index >= 0; index -= 1)); do
    restore_item "$index" || failed="1"
  done
  [[ "$failed" == "0" ]]
}

cleanup() {
  local status=$?
  trap - EXIT
  if ! restore_all; then
    status=1
  fi
  if [[ "$KEEP_BACKUP" == "1" || "$status" -ne 0 ]]; then
    log "Backup retained at $BACKUP_ROOT"
  else
    rm -rf "$BACKUP_ROOT"
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 700 "$BACKUP_ROOT"
printf 'path\texisted\tkind\tmode\tchecksum\tbackup\n' >"$MANIFEST"

backup_item "$FOOLERY_SETTINGS"
if [[ -n "${OPENCODE_CONFIG:-}" ]]; then
  backup_item "$OPENCODE_CONFIG"
elif [[ -n "${OPENCODE_CONFIG_DIR:-}" ]]; then
  backup_item "$OPENCODE_CONFIG_DIR"
else
  backup_item "$CONFIG_HOME/opencode"
fi

RUNTIME="${FOOLERY_APPROVAL_NODE:-node}"
if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  RUNTIME="bun"
fi
if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  red_banner "Neither node nor bun is available to run the harness driver."
  exit 1
fi

log "Config backup root: $BACKUP_ROOT"
log "Running approval harness driver with $RUNTIME"

export FOOLERY_APPROVAL_BACKUP_ROOT="$BACKUP_ROOT"
export FOOLERY_APPROVAL_SETTINGS_PATH="$FOOLERY_SETTINGS"

"$RUNTIME" "$ROOT_DIR/scripts/test-cli-approvals-manual.mjs" "$@"
