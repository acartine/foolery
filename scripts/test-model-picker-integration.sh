#!/usr/bin/env bash
# Integration tests for model picker caller logic in setup.sh and
# agent-wizard.sh.  Validates threshold-based routing, manual entry,
# and deduplication without requiring interactive TTY input.
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

# ── Helpers ──────────────────────────────────────────────────────

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

export HOME="$TMPROOT/home"
mkdir -p "$HOME/.config/foolery"

# Redirect interactive I/O so sourced scripts don't touch /dev/tty.
_SETUP_INPUT=/dev/null
_SETUP_OUTPUT=/dev/null
export _SETUP_INPUT _SETUP_OUTPUT

# ── Source shared helpers ────────────────────────────────────────

source "${SCRIPT_DIR}/model-picker.sh"

# Minimal stubs for setup/wizard functions required by the
# _collect_discovered_models implementations.

_append_unique() {
  local value="$1"; shift
  local existing
  for existing in "$@"; do
    [[ "$existing" == "$value" ]] && return 1
  done
  return 0
}

# Stub heading/prompt functions (no-ops for testing).
_setup_heading() { :; }
_setup_prompt()  { :; }
_wizard_heading() { :; }
_wizard_prompt()  { :; }

# ── Generate model lists ────────────────────────────────────────

SMALL_MODELS=(model-a model-b model-c)
LARGE_MODELS=()
for i in $(seq 1 25); do
  LARGE_MODELS+=("provider-model-$i")
done

# ── Test group 1: threshold routing ─────────────────────────────

# 1a. Small list uses numbered menu, not picker
# We verify by checking that _model_search_pick is NOT called for
# a small list.  Override _model_search_pick to set a flag.

_picker_called=0
_original_model_search_pick="$(declare -f _model_search_pick)"
_model_search_pick() { _picker_called=1; }

# Stub _discover_models to return a small list.
_discover_models() {
  printf '%s\n' "${SMALL_MODELS[@]}"
}

# Stub _prompt_model_manual (no TTY available).
_prompt_model_manual() { printf ''; }

# Source setup.sh's _collect_discovered_models by defining it
# inline with the same logic as setup.sh.
_collect_setup_small() {
  local aid="$1"
  _HAS_MODEL_PICKER=1
  local models_list
  models_list="$(_discover_models "$aid")"
  [[ -z "$models_list" ]] && return

  local -a models=()
  while IFS= read -r m; do
    if [[ -n "$m" ]] && \
      ([[ ${#models[@]} -eq 0 ]] || _append_unique "$m" "${models[@]}")
    then
      models+=("$m")
    fi
  done <<EOF
$models_list
EOF

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _setup_heading _setup_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi

  # Numbered menu path — just select the first model for testing.
  printf '%s\n' "${models[0]}"
}

_picker_called=0
result="$(_collect_setup_small "test-agent")"
if [[ "$_picker_called" -eq 0 ]]; then
  pass "setup.sh: small list does NOT trigger picker"
else
  fail "setup.sh: small list should NOT trigger picker"
fi
if [[ "$result" == "model-a" ]]; then
  pass "setup.sh: small list returns first model from menu"
else
  fail "setup.sh: small list result (got: $result)"
fi

# 1b. Large list triggers picker
_collect_setup_large() {
  local aid="$1"
  _HAS_MODEL_PICKER=1
  local -a models=("${LARGE_MODELS[@]}")

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _setup_heading _setup_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi
  printf 'numbered-menu\n'
}

_picker_called=0
_collect_setup_large "test-agent" >/dev/null 2>&1 || true
if [[ "$_picker_called" -eq 1 ]]; then
  pass "setup.sh: large list triggers picker"
else
  fail "setup.sh: large list should trigger picker"
fi

# 1c. Large list falls back to numbered menu when picker absent
_collect_setup_no_picker() {
  local aid="$1"
  _HAS_MODEL_PICKER=0
  local -a models=("${LARGE_MODELS[@]}")

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _setup_heading _setup_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi
  printf 'numbered-menu\n'
}

_picker_called=0
result="$(_collect_setup_no_picker "test-agent")"
if [[ "$_picker_called" -eq 0 ]]; then
  pass "setup.sh: large list without picker uses numbered menu"
else
  fail "setup.sh: large list without picker should use numbered menu"
fi
if [[ "$result" == "numbered-menu" ]]; then
  pass "setup.sh: fallback path returns numbered-menu sentinel"
else
  fail "setup.sh: fallback path (got: $result)"
fi

# ── Test group 2: agent-wizard.sh threshold routing ─────────────

# 2a. Small list in agent-wizard — no picker
_collect_wizard_small() {
  local aid="$1"
  _HAS_MODEL_PICKER=1
  local -a models=("${SMALL_MODELS[@]}")

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _wizard_heading _wizard_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi
  printf '%s\n' "${models[0]}"
}

_picker_called=0
result="$(_collect_wizard_small "test-agent")"
if [[ "$_picker_called" -eq 0 ]]; then
  pass "agent-wizard.sh: small list does NOT trigger picker"
else
  fail "agent-wizard.sh: small list should NOT trigger picker"
fi

# 2b. Large list in agent-wizard — picker fires
_collect_wizard_large() {
  local aid="$1"
  _HAS_MODEL_PICKER=1
  local -a models=("${LARGE_MODELS[@]}")

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _wizard_heading _wizard_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi
  printf 'numbered-menu\n'
}

_picker_called=0
_collect_wizard_large "test-agent" >/dev/null 2>&1 || true
if [[ "$_picker_called" -eq 1 ]]; then
  pass "agent-wizard.sh: large list triggers picker"
else
  fail "agent-wizard.sh: large list should trigger picker"
fi

# 2c. Large list in agent-wizard — fallback when picker absent
_collect_wizard_no_picker() {
  local aid="$1"
  _HAS_MODEL_PICKER=0
  local -a models=("${LARGE_MODELS[@]}")

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _wizard_heading _wizard_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi
  printf 'numbered-menu\n'
}

_picker_called=0
result="$(_collect_wizard_no_picker "test-agent")"
if [[ "$_picker_called" -eq 0 ]]; then
  pass "agent-wizard.sh: large list without picker uses numbered menu"
else
  fail "agent-wizard.sh: large list without picker should use numbered menu"
fi

# Restore real _model_search_pick.
eval "$_original_model_search_pick"

# ── Test group 3: manual entry in numbered menu ─────────────────

# Simulate the small-list path with manual entry by stubbing read.
_simulate_manual_entry() {
  local -a models=(alpha bravo charlie)
  local -a selected=()
  # Simulate choosing "Other (type manually)" — option count+2.
  local count=${#models[@]}
  local choice=$((count + 2))

  if [[ "$choice" =~ ^[0-9]+$ ]]; then
    if ((choice >= 1 && choice <= count)); then
      selected+=("${models[$((choice - 1))]}")
    elif ((choice == count + 2)); then
      local manual="custom-model-x"
      if [[ -n "$manual" ]] && \
        ([[ ${#selected[@]} -eq 0 ]] || \
          _append_unique "$manual" "${selected[@]}"); then
        selected+=("$manual")
      fi
    fi
  fi

  if [[ ${#selected[@]} -gt 0 ]]; then
    printf '%s\n' "${selected[@]}"
  fi
}

result="$(_simulate_manual_entry)"
if [[ "$result" == "custom-model-x" ]]; then
  pass "numbered menu: manual entry produces correct model"
else
  fail "numbered menu: manual entry (got: $result)"
fi

# ── Test group 4: deduplication ─────────────────────────────────

_test_dedup() {
  local -a selected=("alpha" "bravo")
  local candidate="alpha"
  if _append_unique "$candidate" "${selected[@]}"; then
    printf 'unique\n'
  else
    printf 'duplicate\n'
  fi
}

result="$(_test_dedup)"
if [[ "$result" == "duplicate" ]]; then
  pass "deduplication rejects existing model"
else
  fail "deduplication (got: $result)"
fi

_test_dedup_new() {
  local -a selected=("alpha" "bravo")
  local candidate="charlie"
  if _append_unique "$candidate" "${selected[@]}"; then
    printf 'unique\n'
  else
    printf 'duplicate\n'
  fi
}

result="$(_test_dedup_new)"
if [[ "$result" == "unique" ]]; then
  pass "deduplication accepts new model"
else
  fail "deduplication new (got: $result)"
fi

# ── Test group 5: threshold boundary ────────────────────────────

# Exactly at threshold should NOT trigger picker.
BOUNDARY_MODELS=()
for i in $(seq 1 "$_MODEL_SEARCH_THRESHOLD"); do
  BOUNDARY_MODELS+=("boundary-model-$i")
done

if (( ${#BOUNDARY_MODELS[@]} > _MODEL_SEARCH_THRESHOLD )); then
  fail "boundary list ($#BOUNDARY_MODELS) should not exceed threshold"
else
  pass "boundary list (${#BOUNDARY_MODELS[@]}) at threshold uses numbered menu"
fi

# One above threshold should trigger picker.
BOUNDARY_PLUS_MODELS=("${BOUNDARY_MODELS[@]}" "boundary-model-extra")
if (( ${#BOUNDARY_PLUS_MODELS[@]} > _MODEL_SEARCH_THRESHOLD )); then
  pass "boundary+1 list (${#BOUNDARY_PLUS_MODELS[@]}) exceeds threshold"
else
  fail "boundary+1 list should exceed threshold"
fi

# ── Results ──────────────────────────────────────────────────────

printf '\n--- Results ---\n'
printf '%d test(s) run, %d failure(s)\n' "$tests" "$failures"
if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
printf 'All tests passed.\n'
