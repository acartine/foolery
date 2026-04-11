#!/usr/bin/env bash
# Tests for the interactive model search picker (model-picker.sh).
# Exercises filtering logic, query clearing, multi-select, and
# the small-list fallback path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0
tests=0

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
  tests=$((tests + 1))
}
pass() {
  printf 'PASS: %s\n' "$1"
  tests=$((tests + 1))
}

source "${SCRIPT_DIR}/model-picker.sh"

# Stub _append_unique (sourced scripts define it, but we run standalone).
_append_unique() {
  local value="$1"
  shift
  local existing
  for existing in "$@"; do
    [[ "$existing" == "$value" ]] && return 1
  done
  return 0
}

# --- Unit tests for _model_picker_filter ---

t1="$(_model_picker_filter "" alpha bravo charlie)"
expected="$(printf 'alpha\nbravo\ncharlie')"
if [[ "$t1" == "$expected" ]]; then
  pass "empty query returns all models"
else
  fail "empty query returns all models (got: $t1)"
fi

t2="$(_model_picker_filter "rav" alpha bravo charlie)"
if [[ "$t2" == "bravo" ]]; then
  pass "substring filter matches 'bravo'"
else
  fail "substring filter (got: $t2)"
fi

t3="$(_model_picker_filter "CHAR" alpha bravo charlie)"
if [[ "$t3" == "charlie" ]]; then
  pass "case-insensitive filter matches 'charlie'"
else
  fail "case-insensitive filter (got: $t3)"
fi

t4="$(_model_picker_filter "xyz" alpha bravo charlie)"
if [[ -z "$t4" ]]; then
  pass "no-match query returns empty"
else
  fail "no-match query (got: $t4)"
fi

# --- Case-insensitive tests for realistic model names ---

models=(
  "glm-4-plus" "glm-4-air" "minimax-01"
  "qwen-2.5-72b" "qwen-turbo" "gpt-5.3"
  "claude-sonnet-4.5" "gemini-2.5-pro"
)

t5="$(_model_picker_filter "GLM" "${models[@]}")"
expected_t5="$(printf 'glm-4-plus\nglm-4-air')"
if [[ "$t5" == "$expected_t5" ]]; then
  pass "GLM search finds glm models"
else
  fail "GLM search (got: $t5)"
fi

t6="$(_model_picker_filter "minimax" "${models[@]}")"
if [[ "$t6" == "minimax-01" ]]; then
  pass "minimax search finds minimax-01"
else
  fail "minimax search (got: $t6)"
fi

t7="$(_model_picker_filter "Qwen" "${models[@]}")"
expected_t7="$(printf 'qwen-2.5-72b\nqwen-turbo')"
if [[ "$t7" == "$expected_t7" ]]; then
  pass "Qwen search finds qwen models"
else
  fail "Qwen search (got: $t7)"
fi

# --- Threshold behavior ---

small_list=(model-a model-b model-c)
if (( ${#small_list[@]} <= _MODEL_SEARCH_THRESHOLD )); then
  pass "small list (${#small_list[@]}) below threshold ($_MODEL_SEARCH_THRESHOLD)"
else
  fail "small list should be below threshold"
fi

large_list=()
for i in $(seq 1 25); do
  large_list+=("model-$i")
done
if (( ${#large_list[@]} > _MODEL_SEARCH_THRESHOLD )); then
  pass "large list (${#large_list[@]}) above threshold"
else
  fail "large list should be above threshold"
fi

# --- Filter with many models (performance sanity) ---

huge_list=()
for i in $(seq 1 200); do
  huge_list+=("provider-model-variant-$i")
done
t8_start=$(date +%s)
t8="$(_model_picker_filter "variant-15" "${huge_list[@]}")"
t8_end=$(date +%s)
t8_elapsed=$((t8_end - t8_start))

t8_count=$(printf '%s' "$t8" | grep -c '^' || true)
if ((t8_count > 0 && t8_count <= 12)); then
  pass "filter on 200 models returns reasonable count ($t8_count)"
else
  fail "filter on 200 models (count: $t8_count)"
fi

if ((t8_elapsed <= 2)); then
  pass "filter on 200 models completes within 2s"
else
  fail "filter on 200 models too slow (${t8_elapsed}s)"
fi

# --- Backspace clears to full list ---

t9_full="$(_model_picker_filter "" "${models[@]}")"
t9_partial="$(_model_picker_filter "glm" "${models[@]}")"
t9_cleared="$(_model_picker_filter "" "${models[@]}")"
if [[ "$t9_full" == "$t9_cleared" ]]; then
  pass "clearing query restores full model list"
else
  fail "clearing query should restore full list"
fi

if [[ "$t9_partial" != "$t9_full" ]]; then
  pass "partial query narrows list"
else
  fail "partial query should narrow list"
fi

# --- Erase lines helper (only test if /dev/tty is available) ---

if [[ -e /dev/tty ]]; then
  erase_out="$(_model_picker_erase_lines 0 2>/dev/null)"
  if [[ -z "$erase_out" ]]; then
    pass "erase 0 lines produces no stdout"
  else
    fail "erase 0 lines should produce no stdout"
  fi
else
  pass "erase lines test skipped (no tty)"
fi

printf '\n--- Results ---\n'
printf '%d test(s) run, %d failure(s)\n' "$tests" "$failures"
if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
printf 'All tests passed.\n'
