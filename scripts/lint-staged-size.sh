#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

files=()
while IFS= read -r -d '' path; do
  case "$path" in
    src/*.ts|src/*.tsx|src/**/*.ts|src/**/*.tsx)
      files+=("$path")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z -- src)

if [[ "${#files[@]}" -eq 0 ]]; then
  exit 0
fi

echo "Running ESLint on staged source files..."
bun run lint -- "${files[@]}"
