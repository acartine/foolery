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

wait_for_artifact_run() {
  local tag="$1"
  local interval timeout_seconds started_at now run_id
  interval="${FOOLERY_RELEASE_POLL_INTERVAL_SECONDS:-10}"
  timeout_seconds="${FOOLERY_RELEASE_WAIT_TIMEOUT_SECONDS:-600}"
  started_at="$(date +%s)"

  while true; do
    run_id="$(gh run list --workflow "Release Runtime Artifact" --event release --limit 20 --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$tag\") | .databaseId" | head -n 1 || true)"
    if [[ "$run_id" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$run_id"
      return 0
    fi

    now="$(date +%s)"
    if ((now - started_at >= timeout_seconds)); then
      fail "Timed out waiting for release artifact workflow run for $tag."
    fi

    log "Waiting for Release Runtime Artifact workflow to start for $tag..."
    sleep "$interval"
  done
}

verify_release_assets() {
  local tag="$1"
  local tarball_count
  tarball_count="$(gh release view "$tag" --json assets --jq '[.assets[].name | select(test("^foolery-runtime-.*\\.tar\\.gz$"))] | length' || true)"

  if [[ ! "$tarball_count" =~ ^[0-9]+$ ]] || ((tarball_count < 1)); then
    fail "Release $tag completed but runtime tarball assets were not found."
  fi

  log "Release assets published ($tarball_count runtime tarball(s))."
}

wait_for_artifacts() {
  local tag="$1"
  local run_id interval
  interval="${FOOLERY_RELEASE_POLL_INTERVAL_SECONDS:-10}"

  run_id="$(wait_for_artifact_run "$tag")"
  log "Watching artifact workflow run $run_id (updates every ${interval}s)"
  gh run watch "$run_id" --interval "$interval" --exit-status
  verify_release_assets "$tag"
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

  if [[ "${FOOLERY_RELEASE_WAIT_FOR_ARTIFACTS:-1}" == "1" ]]; then
    wait_for_artifacts "$tag"
  else
    log "Skipping artifact wait (FOOLERY_RELEASE_WAIT_FOR_ARTIFACTS=0)."
  fi
}

main "$@"
