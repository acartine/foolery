#!/usr/bin/env bash
set -euo pipefail

if ! command -v bd >/dev/null 2>&1; then
  echo "Error: bd CLI is required on PATH." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script from inside a git worktree." >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
hooks_dir=$(git rev-parse --git-path hooks)

cd "$repo_root"

origin_url=$(git remote get-url origin)
escaped_origin_url=${origin_url//\'/\'\'}

bd config set sync.git-remote "$origin_url"

if ! bd sql --csv "SELECT name FROM dolt_remotes WHERE name='origin'" | tail -n +2 | tr -d '\r' | grep -qx "origin"; then
  bd sql "CALL DOLT_REMOTE('add', 'origin', '$escaped_origin_url')"
fi

timestamp=$(date +%Y%m%d-%H%M%S)
backups=()

backup_hook() {
  hook_name="$1"
  hook_path="$hooks_dir/$hook_name"
  if [ -f "$hook_path" ]; then
    backup_path="$hook_path.bak-$timestamp"
    cp "$hook_path" "$backup_path"
    backups+=("$backup_path")
  fi
}

backup_hook "pre-push"
backup_hook "post-merge"
backup_hook "post-checkout"

cat >"$hooks_dir/pre-push" <<'HOOK'
#!/usr/bin/env sh
# bd-shim v1
# bd-hooks-version: 0.55.1
# Custom Beads hook: Dolt-native sync before git push.

set -u

if ! command -v bd >/dev/null 2>&1; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$repo_root" ]; then
  cd "$repo_root" || exit 0
fi

if [ ! -d .beads ]; then
  exit 0
fi

branch=$(bd sql --csv "SELECT active_branch()" 2>/dev/null | tail -n 1 | tr -d '\r')
if [ -z "$branch" ]; then
  branch="main"
fi

commit_out=$(bd vc commit -m "hook: pre-push dolt checkpoint" 2>&1)
commit_rc=$?
if [ $commit_rc -ne 0 ] && ! printf '%s\n' "$commit_out" | grep -qi "nothing to commit"; then
  echo "Error: failed to checkpoint Dolt changes before push" >&2
  echo "$commit_out" >&2
  exit 1
fi

push_out=$(bd sql "CALL DOLT_PUSH('origin','$branch')" 2>&1)
push_rc=$?
if [ $push_rc -ne 0 ]; then
  echo "Error: failed to push Dolt data to origin/$branch" >&2
  echo "$push_out" >&2
  exit 1
fi

exit 0
HOOK

cat >"$hooks_dir/post-merge" <<'HOOK'
#!/usr/bin/env sh
# bd-shim v1
# bd-hooks-version: 0.55.1
# Custom Beads hook: Dolt-native sync after git merge/pull.

set -u

if ! command -v bd >/dev/null 2>&1; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$repo_root" ]; then
  cd "$repo_root" || exit 0
fi

if [ ! -d .beads ]; then
  exit 0
fi

branch=$(bd sql --csv "SELECT active_branch()" 2>/dev/null | tail -n 1 | tr -d '\r')
if [ -z "$branch" ]; then
  branch="main"
fi

pull_out=$(bd sql "CALL DOLT_PULL('origin','$branch')" 2>&1)
pull_rc=$?
if [ $pull_rc -eq 0 ]; then
  exit 0
fi

if printf '%s\n' "$pull_out" | grep -qi "cannot merge with uncommitted changes"; then
  commit_out=$(bd vc commit -m "hook: post-merge dolt checkpoint" 2>&1)
  commit_rc=$?
  if [ $commit_rc -ne 0 ] && ! printf '%s\n' "$commit_out" | grep -qi "nothing to commit"; then
    echo "Warning: post-merge Dolt checkpoint failed" >&2
    echo "$commit_out" >&2
  fi

  pull_out=$(bd sql "CALL DOLT_PULL('origin','$branch')" 2>&1)
  pull_rc=$?
fi

if [ $pull_rc -ne 0 ]; then
  echo "Warning: post-merge Dolt pull failed" >&2
  echo "$pull_out" >&2
fi

exit 0
HOOK

cat >"$hooks_dir/post-checkout" <<'HOOK'
#!/usr/bin/env sh
# bd-shim v1
# bd-hooks-version: 0.55.1
# Custom Beads hook: no-op.

exit 0
HOOK

chmod +x "$hooks_dir/pre-push" "$hooks_dir/post-merge" "$hooks_dir/post-checkout"

echo "Changed hook files:"
echo " - $hooks_dir/pre-push"
echo " - $hooks_dir/post-merge"
echo " - $hooks_dir/post-checkout"

echo "Backup files created:"
if [ ${#backups[@]} -eq 0 ]; then
  echo " - (none)"
else
  printf ' - %s\n' "${backups[@]}"
fi

echo
echo "Validate with:"
echo "  bd hooks list"
echo "  bd doctor"
echo "  $hooks_dir/pre-push"
echo
echo "Caveat: running 'bd hooks install --force' will overwrite these custom hooks."
