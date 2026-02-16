#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${FOOLERY_DIST_DIR:-$ROOT_DIR/dist}"
ARTIFACT_BASENAME="${FOOLERY_ASSET_BASENAME:-foolery-runtime}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foolery-runtime.XXXXXX")"
RUNTIME_DIR="$TMP_DIR/foolery-runtime"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log() {
  printf '[foolery-package] %s\n' "$*"
}

fail() {
  printf '[foolery-package] ERROR: %s\n' "$*" >&2
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

main() {
  require_cmd bun
  require_cmd tar
  require_cmd uname

  local os arch version artifact_name artifact_path
  os="$(normalize_os "$(uname -s)")"
  arch="$(normalize_arch "$(uname -m)")"

  version="${FOOLERY_VERSION:-${GITHUB_REF_NAME:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}}"
  artifact_name="${ARTIFACT_BASENAME}-${os}-${arch}.tar.gz"
  artifact_path="$DIST_DIR/$artifact_name"

  log "Installing dependencies"
  (
    cd "$ROOT_DIR"
    bun install --frozen-lockfile
  )

  log "Building production app"
  (
    cd "$ROOT_DIR"
    bun run build
  )

  rm -rf "$RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"

  log "Preparing runtime bundle"
  cp "$ROOT_DIR/package.json" "$RUNTIME_DIR/package.json"
  cp "$ROOT_DIR/bun.lock" "$RUNTIME_DIR/bun.lock"
  printf '%s\n' "$version" > "$RUNTIME_DIR/RELEASE_VERSION"

  log "Installing production dependencies into runtime bundle"
  (
    cd "$RUNTIME_DIR"
    bun install --frozen-lockfile --production
  )

  cp -R "$ROOT_DIR/.next" "$RUNTIME_DIR/.next"
  cp -R "$ROOT_DIR/public" "$RUNTIME_DIR/public"

  mkdir -p "$DIST_DIR"
  rm -f "$artifact_path" "$artifact_path.sha256"
  tar -C "$TMP_DIR" -czf "$artifact_path" foolery-runtime

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$artifact_path" > "$artifact_path.sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$artifact_path" > "$artifact_path.sha256"
  fi

  log "Wrote $artifact_path"
  if [[ -f "$artifact_path.sha256" ]]; then
    log "Wrote $artifact_path.sha256"
  fi
}

main "$@"
