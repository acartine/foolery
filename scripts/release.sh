#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[foolery-release] %s\n' "$*"
}

fail() {
  printf '[foolery-release] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

main() {
  require_cmd gh

  local tag target
  tag="${1:-}"
  target="${FOOLERY_RELEASE_TARGET:-main}"

  if [[ -z "$tag" ]]; then
    fail "Usage: bun run release -- <tag> [extra gh release create args]"
  fi

  shift || true

  if [[ "${FOOLERY_RELEASE_DRY_RUN:-0}" == "1" ]]; then
    log "Dry run enabled. Would run: gh release create $tag --target $target --generate-notes --latest $*"
    return 0
  fi

  log "Creating GitHub release $tag from target $target"
  gh release create "$tag" --target "$target" --generate-notes --latest "$@"
}

main "$@"
