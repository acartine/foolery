#!/usr/bin/env bash
# Build a local foolery CLI binary from the repo source.
#
# Usage:
#   bash scripts/build-cli.sh [OUTPUT_PATH]
#
# OUTPUT_PATH defaults to ./dist/foolery.
#
# The generated binary points APP_DIR at this repo checkout,
# so it uses whatever .next build and node_modules are present.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-$ROOT_DIR/dist/foolery}"

mkdir -p "$(dirname "$OUTPUT")"

# Set env vars so install.sh's variable defaults resolve to our paths.
# Respect pre-set values for building production-style binaries.
export FOOLERY_INSTALL_ROOT="${FOOLERY_INSTALL_ROOT:-$ROOT_DIR}"
export FOOLERY_APP_DIR="${FOOLERY_APP_DIR:-$ROOT_DIR}"
export FOOLERY_BIN_DIR="${FOOLERY_BIN_DIR:-$(cd "$(dirname "$OUTPUT")" && pwd)}"
export FOOLERY_STATE_DIR="${FOOLERY_STATE_DIR:-$ROOT_DIR/.local-state}"

# Source install.sh without the final `main "$@"` to get write_launcher()
# without triggering a full install. Process substitution doesn't work here
# because the heredoc inside write_launcher confuses bash's parser, so we
# use a temp file.
_tmp="$(mktemp "${TMPDIR:-/tmp}/foolery-build-cli.XXXXXX")"
trap 'rm -f "$_tmp"' EXIT
# Strip the final `main "$@"` call so sourcing doesn't trigger a full install.
# Use grep to find the last line matching `main "$@"` and cut before it.
_last_main=$(grep -n '^main "\$@"' "$ROOT_DIR/scripts/install.sh" | tail -1 | cut -d: -f1)
head -n $((_last_main - 1)) "$ROOT_DIR/scripts/install.sh" > "$_tmp"
source "$_tmp"

# Override LAUNCHER_PATH to our output location.
LAUNCHER_PATH="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"

write_launcher

if [[ -x "$LAUNCHER_PATH" ]]; then
  printf '[build-cli] Wrote %s\n' "$LAUNCHER_PATH"
else
  printf '[build-cli] ERROR: failed to produce %s\n' "$LAUNCHER_PATH" >&2
  exit 1
fi
