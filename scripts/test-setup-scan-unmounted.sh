#!/usr/bin/env bash
# Test: setup directory scan should only display unmounted repositories.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0

fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }
pass() { printf 'PASS: %s\n' "$1"; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

export HOME="$TMPROOT/home"
mkdir -p "$HOME"

SCAN_DIR="$TMPROOT/repos"
mkdir -p "$SCAN_DIR/repo-a/.knots"
mkdir -p "$SCAN_DIR/repo-b/.knots"
mkdir -p "$SCAN_DIR/repo-c/.beads"

REGISTRY_DIR="$HOME/.config/foolery"
mkdir -p "$REGISTRY_DIR"
cat >"$REGISTRY_DIR/registry.json" <<'REG'
{
  "repos": [
    {
      "path": "PLACEHOLDER_REPO_A",
      "name": "repo-a",
      "addedAt": "2026-01-01T00:00:00Z",
      "memoryManagerType": "knots"
    }
  ]
}
REG
sed -i.bak "s|PLACEHOLDER_REPO_A|$SCAN_DIR/repo-a|" \
  "$REGISTRY_DIR/registry.json"
rm -f "$REGISTRY_DIR/registry.json.bak"

# Source setup.sh to get access to internal functions.
# Suppress interactive prompts by providing stdin input.
source "$SCRIPT_DIR/setup.sh"

# --- Test 1: _display_scan_results only shows unmounted repos ---
_REGISTRY_CACHE_VALID=0
found_repos="$(printf 'knots|%s\nknots|%s\nbeads|%s' \
  "$SCAN_DIR/repo-a" "$SCAN_DIR/repo-b" "$SCAN_DIR/repo-c")"

unmounted_repos=""
while IFS= read -r record; do
  [[ -z "$record" ]] && continue
  repo_dir="${record#*|}"
  if ! _is_path_registered "$repo_dir"; then
    unmounted_repos="$(printf '%s\n%s' "$unmounted_repos" "$record")"
  fi
done <<EOF
$found_repos
EOF
unmounted_repos="$(printf '%s\n' "$unmounted_repos" | sed '/^$/d')"

stderr_output="$(_display_scan_results "$unmounted_repos" 2>&1 1>/dev/null)"

if printf '%s' "$stderr_output" | grep -q "repo-a"; then
  fail "mounted repo-a should not appear in scan results"
else
  pass "mounted repo-a is excluded from scan results"
fi

if printf '%s' "$stderr_output" | grep -q "repo-b"; then
  pass "unmounted repo-b appears in scan results"
else
  fail "unmounted repo-b should appear in scan results"
fi

if printf '%s' "$stderr_output" | grep -q "repo-c"; then
  pass "unmounted repo-c appears in scan results"
else
  fail "unmounted repo-c should appear in scan results"
fi

# --- Test 2: header says "unmounted" ---
if printf '%s' "$stderr_output" | grep -qi "unmounted"; then
  pass "header mentions 'unmounted'"
else
  fail "header should mention 'unmounted'"
fi

# --- Test 3: numbering starts at 1 for first unmounted repo ---
if printf '%s' "$stderr_output" | grep -q "1).*repo-b"; then
  pass "repo-b is numbered 1 (not 2)"
else
  fail "repo-b should be numbered 1"
fi

# --- Test 4: all-mounted case returns empty ---
_REGISTRY_CACHE_VALID=0
cat >"$REGISTRY_DIR/registry.json" <<REG2
{
  "repos": [
    {"path": "$SCAN_DIR/repo-a", "name": "repo-a",
     "addedAt": "2026-01-01T00:00:00Z", "memoryManagerType": "knots"},
    {"path": "$SCAN_DIR/repo-b", "name": "repo-b",
     "addedAt": "2026-01-01T00:00:00Z", "memoryManagerType": "knots"},
    {"path": "$SCAN_DIR/repo-c", "name": "repo-c",
     "addedAt": "2026-01-01T00:00:00Z", "memoryManagerType": "beads"}
  ]
}
REG2
_REGISTRY_CACHE_VALID=0
scan_output="$(_scan_and_mount_repos "$SCAN_DIR" 2>&1)"
if printf '%s' "$scan_output" | grep -q "already mounted"; then
  pass "all-mounted case shows correct message"
else
  fail "all-mounted case should say 'already mounted'"
fi

printf '\n--- Results ---\n'
if [[ "$failures" -gt 0 ]]; then
  printf '%d test(s) FAILED\n' "$failures"
  exit 1
fi
printf 'All tests passed.\n'
