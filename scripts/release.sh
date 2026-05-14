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

current_branch() {
  local branch
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || {
    fail "Release must run from an attached branch; HEAD is detached. " \
      "Checkout the release target branch first."
  }

  printf '%s\n' "$branch"
}

require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    fail "Release worktree is not clean. Commit, stash, or discard local changes before releasing."
  fi
}

require_release_branch() {
  local target="$1" branch
  branch="$(current_branch)"

  if [[ "$branch" != "$target" ]]; then
    fail "Release target is '$target' but current branch is '$branch'. " \
      "Checkout '$target' first or set FOOLERY_RELEASE_TARGET='$branch'."
  fi
}

branch_upstream() {
  local upstream
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" || {
    fail "Release branch has no upstream. Configure one with: " \
      "git branch --set-upstream-to=origin/$(current_branch)"
  }

  printf '%s\n' "$upstream"
}

fetch_upstream_and_tags() {
  local upstream="$1" remote ref
  remote="${upstream%%/*}"
  ref="${upstream#*/}"

  if [[ -z "$remote" || -z "$ref" || "$remote" == "$ref" ]]; then
    fail "Could not parse upstream '$upstream'. Configure the release branch " \
      "to track a remote branch."
  fi

  git fetch --quiet --tags "$remote" "+refs/heads/${ref}:refs/remotes/${remote}/${ref}"
}

prepare_release_branch() {
  local target="$1" dry_run="$2" upstream local_head upstream_head

  require_release_branch "$target"
  require_clean_worktree

  upstream="$(branch_upstream)"
  fetch_upstream_and_tags "$upstream"

  local_head="$(git rev-parse HEAD)"
  upstream_head="$(git rev-parse "$upstream")"

  if [[ "$local_head" == "$upstream_head" ]]; then
    log "Release branch '$target' is current with $upstream."
    return 0
  fi

  if git merge-base --is-ancestor HEAD "$upstream"; then
    if [[ "$dry_run" == "1" ]]; then
      fail "Release branch '$target' is behind $upstream. Run 'git pull --ff-only' before dry-run."
    fi

    log "Fast-forwarding '$target' to $upstream before release."
    git merge --ff-only "$upstream"
    require_clean_worktree
    return 0
  fi

  if git merge-base --is-ancestor "$upstream" HEAD; then
    log "Release branch '$target' is ahead of $upstream; release will push local commits."
    return 0
  fi

  fail "Release branch '$target' has diverged from $upstream. Rebase or merge before releasing."
}

run_quality_gates() {
  if [[ "${FOOLERY_RELEASE_SKIP_GATES:-0}" == "1" ]]; then
    log "Skipping release quality gates because FOOLERY_RELEASE_SKIP_GATES=1."
    return 0
  fi

  require_cmd bun
  require_cmd bunx

  log "Running release quality gates."
  log "Gate: bun run lint"
  bun run lint
  log "Gate: bunx tsc --noEmit"
  bunx tsc --noEmit
  log "Gate: bun run test"
  bun run test
  log "Gate: bun run build"
  bun run build
  require_clean_worktree
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
  local latest
  latest="$(git tag --sort=-v:refname | while read -r t; do
    if [[ "$t" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s\n' "$t"
      break
    fi
  done)"

  if [[ -z "$latest" ]]; then
    fail "No semver release tags (v*.*.* ) found. " \
      "Create an initial tag first (e.g. git tag v0.0.0)."
  fi

  printf '%s\n' "${latest#v}"
}

update_package_version() {
  local pkg="$1" new_version="$2"
  sed -i.bak \
    "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$new_version\"/" \
    "$pkg"
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
  FOOLERY_RELEASE_PUSH_RETRIES           Atomic push retry count (default: 2)
  FOOLERY_RELEASE_SKIP_GATES=1           Skip final release gates (default: 0)

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
  local interval timeout_seconds started_at now run_id jq_filter
  interval="${FOOLERY_RELEASE_POLL_INTERVAL_SECONDS:-10}"
  timeout_seconds="${FOOLERY_RELEASE_WAIT_TIMEOUT_SECONDS:-600}"
  started_at="$(date +%s)"
  jq_filter=".[] | select(.displayTitle == \"$tag\") | .databaseId"

  while true; do
    run_id="$(
      gh run list \
        --workflow "Release Runtime Artifact" \
        --event release \
        --limit 20 \
        --json databaseId,displayTitle \
        --jq "$jq_filter" \
        | head -n 1 \
        || true
    )"
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
  local tarball_count jq_filter
  jq_filter='[.assets[].name | select(test("^foolery-runtime-.*[.]tar[.]gz$"))] | length'
  tarball_count="$(gh release view "$tag" --json assets --jq "$jq_filter" || true)"

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

publish_git_refs() {
  local target="$1" tag="$2" upstream="$3"
  local retries attempt
  retries="${FOOLERY_RELEASE_PUSH_RETRIES:-2}"

  for ((attempt = 0; attempt <= retries; attempt += 1)); do
    if git push --atomic origin "HEAD:refs/heads/${target}" "refs/tags/${tag}"; then
      return 0
    fi

    if ((attempt == retries)); then
      fail "Failed to push $target and $tag atomically after $((retries + 1)) attempt(s)."
    fi

    log "Push raced with a remote update; rebasing release commit onto $upstream and retrying."
    fetch_upstream_and_tags "$upstream"
    git rebase "$upstream"
    git tag -f "$tag" HEAD
    run_quality_gates
  done
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

  prepare_release_branch "$target" "$dry_run"

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
    log "  - Run release quality gates"
    log "  - Update package.json to $new_version"
    log "  - git commit and tag $tag"
    log "  - git push --atomic origin HEAD:refs/heads/$target refs/tags/$tag"
    log "  - gh release create $tag --target $target --generate-notes --latest"
    return 0
  fi

  run_quality_gates

  local pkg
  pkg="$(git rev-parse --show-toplevel)/package.json"
  update_package_version "$pkg" "$new_version"

  git add package.json
  git commit -m "release: $tag"
  git tag "$tag"

  local upstream
  upstream="$(branch_upstream)"
  publish_git_refs "$target" "$tag" "$upstream"

  local prev_tag notes
  prev_tag="v${current_version}"
  notes="$(git log "${prev_tag}..${tag}~1" --pretty=format:'- %s' | grep -v '^- release:' || true)"
  if [[ -z "$notes" ]]; then
    notes="Maintenance release."
  fi

  log "Creating GitHub release $tag from target $target"
  gh release create "$tag" --target "$target" --latest \
    --notes "$(printf '%s\n\n**Full Changelog**: https://github.com/%s/compare/%s...%s' \
      "$notes" "$(gh repo view --json nameWithOwner -q .nameWithOwner)" "$prev_tag" "$tag")"

  if [[ "$wait_artifacts" == "1" ]]; then
    wait_for_artifacts "$tag"
  else
    log "Skipping artifact wait."
  fi
}

main "$@"
