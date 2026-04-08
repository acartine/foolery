#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -d ".githooks" ]]; then
  exit 0
fi

hooks_path="$(git config --local --get core.hooksPath || true)"
if [[ "$hooks_path" == ".githooks" ]]; then
  exit 0
fi

git config --local core.hooksPath .githooks
echo "Configured git hooks at .githooks"
