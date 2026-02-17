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

semver_triplet() {
  local raw="$1"
  raw="${raw#v}"
  raw="${raw%%-*}"
  raw="${raw%%+*}"

  local major minor patch
  IFS='.' read -r major minor patch _ <<<"$raw"

  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if [[ -n "${minor:-}" && ! "$minor" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if [[ -n "${patch:-}" && ! "$patch" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s %s %s\n' "$major" "${minor:-0}" "${patch:-0}"
}

bump_version() {
  local current="$1" kind="$2"
  local major minor patch
  read -r major minor patch <<<"$(semver_triplet "$current")"

  case "$kind" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) fail "Unknown bump kind: $kind" ;;
  esac

  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

read_current_version() {
  git fetch --tags --quiet
  local latest
  latest="$(git tag --sort=-v:refname | while read -r t; do
    if [[ "$t" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s\n' "$t"
      break
    fi
  done)"

  if [[ -z "$latest" ]]; then
    fail "No semver release tags (v*.*.* ) found. Create an initial tag first (e.g. git tag v0.0.0)."
  fi

  printf '%s\n' "${latest#v}"
}

update_package_version() {
  local pkg="$1" new_version="$2"
  sed -i.bak "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$new_version\"/" "$pkg"
  rm -f "${pkg}.bak"

  local written
  written="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg" | head -n 1)"
  if [[ "$written" != "$new_version" ]]; then
    fail "Failed to update version in $pkg (expected $new_version, got $written)"
  fi
}

usage() {
  cat <<'EOF'
Usage: bun run release [-- [OPTIONS]]

Options:
  --patch                Bump patch version (0.1.0 -> 0.1.1)
  --minor                Bump minor version (0.1.0 -> 0.2.0)
  --major                Bump major version (0.1.0 -> 1.0.0)
  --dry-run              Preview the release without making changes
  --wait-for-artifacts   Wait for release artifacts after publishing (default)
  --no-wait-for-artifacts  Skip waiting for release artifacts
  -h, --help             Show this help message

With no bump flag, an interactive prompt lets you choose the bump type.
--dry-run and --wait-for-artifacts cannot be used together.

Environment variables:
  FOOLERY_RELEASE_DRY_RUN=1              Skip actual release (default: 0)
  FOOLERY_RELEASE_TARGET=<branch>        Release target branch (default: main)
  FOOLERY_RELEASE_WAIT_FOR_ARTIFACTS=0   Skip waiting for artifacts (default: 1)
  FOOLERY_RELEASE_POLL_INTERVAL_SECONDS  Poll interval in seconds (default: 10)
  FOOLERY_RELEASE_WAIT_TIMEOUT_SECONDS   Artifact wait timeout (default: 600)

Flags override their corresponding environment variables.
EOF
}

prompt_bump_kind() {
  local current="$1"
  local v_patch v_minor v_major
  v_patch="$(bump_version "$current" patch)"
  v_minor="$(bump_version "$current" minor)"
  v_major="$(bump_version "$current" major)"

  printf '\n' >/dev/tty
  printf '  [patch - %s]  [p]\n' "$v_patch" >/dev/tty
  printf '  [minor - %s]  [i]\n' "$v_minor" >/dev/tty
  printf '  [major - %s]  [j]\n' "$v_major" >/dev/tty
  printf '\n' >/dev/tty

  local choice
  read -rp 'Select [p]: ' choice </dev/tty >/dev/tty
  choice="${choice:-p}"

  case "$choice" in
    p) printf 'patch\n' ;;
    i) printf 'minor\n' ;;
    j) printf 'major\n' ;;
    *) fail "Invalid selection: $choice" ;;
  esac
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

    log "Waiting for Release Runtime Artifact workflow to start for $tag..." >&2
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
  require_cmd git
  require_cmd sed

  local bump_kind="" target dry_run="" wait_artifacts=""
  local wait_artifacts_explicit=0
  target="${FOOLERY_RELEASE_TARGET:-main}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --patch) bump_kind="patch"; shift ;;
      --minor) bump_kind="minor"; shift ;;
      --major) bump_kind="major"; shift ;;
      --dry-run) dry_run="1"; shift ;;
      --wait-for-artifacts) wait_artifacts="1"; wait_artifacts_explicit=1; shift ;;
      --no-wait-for-artifacts) wait_artifacts="0"; shift ;;
      -h|--help) usage; return 0 ;;
      *)
        printf 'Unrecognized option: %s\n' "$1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  # Resolve flags with env var fallbacks
  dry_run="${dry_run:-${FOOLERY_RELEASE_DRY_RUN:-0}}"
  if [[ -z "$wait_artifacts" ]]; then
    wait_artifacts="${FOOLERY_RELEASE_WAIT_FOR_ARTIFACTS:-1}"
    if [[ "$wait_artifacts" == "1" ]]; then
      wait_artifacts_explicit=0
    else
      wait_artifacts_explicit=1
    fi
  fi

  # Only error when wait-for-artifacts was explicitly requested with dry-run
  if [[ "$dry_run" == "1" && "$wait_artifacts" == "1" && "$wait_artifacts_explicit" == "1" ]]; then
    fail "--dry-run and --wait-for-artifacts cannot be used together"
  fi

  # Dry run implies no artifact wait
  if [[ "$dry_run" == "1" ]]; then
    wait_artifacts="0"
  fi

  local current_version
  current_version="$(read_current_version)"

  if [[ -z "$bump_kind" ]]; then
    bump_kind="$(prompt_bump_kind "$current_version")"
  fi

  local new_version tag
  new_version="$(bump_version "$current_version" "$bump_kind")"
  tag="v${new_version}"

  log "Bumping $current_version -> $new_version ($bump_kind)"

  if [[ "$dry_run" == "1" ]]; then
    log "Dry run enabled. Would:"
    log "  - Update package.json to $new_version"
    log "  - git commit and tag $tag"
    log "  - git push && git push --tags"
    log "  - gh release create $tag --target $target --generate-notes --latest"
    return 0
  fi

  local pkg
  pkg="$(git rev-parse --show-toplevel)/package.json"
  update_package_version "$pkg" "$new_version"

  git add package.json
  git commit -m "release: $tag"
  git tag "$tag"
  git push
  git push --tags

  log "Creating GitHub release $tag from target $target"
  gh release create "$tag" --target "$target" --generate-notes --latest

  if [[ "$wait_artifacts" == "1" ]]; then
    wait_for_artifacts "$tag"
  else
    log "Skipping artifact wait."
  fi
}

main "$@"
