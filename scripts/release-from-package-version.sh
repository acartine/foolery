#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT_DIR/package.json"

log() {
  printf '[foolery-release-ci] %s\n' "$*"
}

fail() {
  printf '[foolery-release-ci] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

read_package_version() {
  local version
  version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PACKAGE_JSON" | head -n 1)"
  if [[ -z "$version" ]]; then
    fail "Unable to determine package version from $PACKAGE_JSON"
  fi
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+].*)?$ ]]; then
    fail "Invalid package version: $version"
  fi
  printf '%s\n' "$version"
}

main() {
  require_cmd git
  require_cmd gh
  require_cmd sed

  local version tag
  version="$(read_package_version)"
  tag="v${version}"

  git -C "$ROOT_DIR" fetch --tags --quiet

  if gh release view "$tag" >/dev/null 2>&1; then
    log "Release $tag already exists; skipping."
    return 0
  fi

  if git -C "$ROOT_DIR" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    log "Tag $tag already exists on origin."
  else
    if git -C "$ROOT_DIR" rev-parse "$tag" >/dev/null 2>&1; then
      log "Tag $tag already exists locally; pushing."
    else
      git -C "$ROOT_DIR" tag "$tag"
      log "Created local tag $tag."
    fi
    git -C "$ROOT_DIR" push origin "$tag"
  fi

  log "Creating GitHub release $tag"
  gh release create "$tag" --generate-notes --latest
  log "Created GitHub release $tag"
}

main "$@"
