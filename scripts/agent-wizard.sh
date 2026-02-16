#!/usr/bin/env bash
# Agent discovery wizard for Foolery install.
# Detects supported AI agents on PATH and writes multi-agent settings.
#
# Designed to be sourced by install.sh; compatible with Bash 3.2+
# (macOS default) — no associative arrays or bash 4+ expansions.

CONFIG_DIR="${HOME}/.config/foolery"
SETTINGS_FILE="${CONFIG_DIR}/settings.toml"

# Known agent ids checked during detection.
KNOWN_AGENTS=(claude codex gemini)

_wizard_log() {
  printf '[foolery-install] %s\n' "$*"
}

# Bash 3.2-safe key-value helpers (replaces associative arrays).
_kv_set() { eval "_KV_${1}__${2}=\$3"; }
_kv_get() { eval "printf '%s' \"\${_KV_${1}__${2}:-\$3}\""; }

# Return the human-readable label for a known agent id.
_agent_label() {
  case "$1" in
    claude) printf 'Claude Code' ;;
    codex)  printf 'OpenAI Codex' ;;
    gemini) printf 'Google Gemini' ;;
    *)      printf '%s' "$1" ;;
  esac
}

# ── TOML writer ───────────────────────────────────────────────

# Write a complete settings file from the collected state.
# Reads from globals: FOUND_AGENTS; uses _kv_get for AGENT_MODELS/ACTION_MAP.
_write_settings_toml() {
  mkdir -p "$CONFIG_DIR"

  local default_cmd="${FOUND_AGENTS[0]:-claude}"
  {
    printf '[agent]\ncommand = "%s"\n\n' "$default_cmd"

    local aid
    for aid in "${FOUND_AGENTS[@]}"; do
      local lbl
      lbl="$(_agent_label "$aid")"
      printf '[agents.%s]\ncommand = "%s"\nlabel = "%s"\n' \
        "$aid" "$aid" "$lbl"
      local _model
      _model="$(_kv_get AGENT_MODELS "$aid" "")"
      if [[ -n "$_model" ]]; then
        printf 'model = "%s"\n' "$_model"
      fi
      printf '\n'
    done

    printf '[actions]\n'
    local action
    for action in take scene direct breakdown hydration; do
      printf '%s = "%s"\n' "$action" "$(_kv_get ACTION_MAP "$action" "default")"
    done
  } > "$SETTINGS_FILE"
}

# ── Detection ─────────────────────────────────────────────────

# Populate FOUND_AGENTS array with ids of agents on PATH.
detect_agents() {
  FOUND_AGENTS=()
  local aid
  for aid in "${KNOWN_AGENTS[@]}"; do
    if command -v "$aid" >/dev/null 2>&1; then
      local agent_path
      agent_path="$(command -v "$aid")"
      _wizard_log "  Found: $aid (at $agent_path)"
      FOUND_AGENTS+=("$aid")
    fi
  done
}

# ── Prompts ───────────────────────────────────────────────────
# All user-facing prompts write to /dev/tty so that command
# substitution callers only capture the actual answer on stdout.

# Ask the user which agent to use for a given action.
# Prints the chosen agent id to stdout.
_prompt_action_choice() {
  local action_label="$1"
  shift
  local agents=("$@")
  local count=${#agents[@]}

  printf '\nWhich agent for "%s"?\n' "$action_label" >/dev/tty
  local i
  for ((i = 0; i < count; i++)); do
    printf '  %d) %s\n' "$((i + 1))" "${agents[$i]}" >/dev/tty
  done

  local choice
  printf 'Choice [1]: ' >/dev/tty
  read -r choice </dev/tty || true
  choice="${choice:-1}"

  if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= count)); then
    printf '%s' "${agents[$((choice - 1))]}"
  else
    printf '%s' "${agents[0]}"
  fi
}

# Ask for an optional model string for a given agent.
_prompt_model() {
  local aid="$1"
  local model
  printf 'Model for %s (optional, press Enter to skip): ' "$aid" >/dev/tty
  read -r model </dev/tty || true
  printf '%s' "$model"
}

# Prompt for per-action agent mappings (multiple agents).
_prompt_action_mappings() {
  local -a action_names=(take scene direct breakdown hydration)
  local -a action_labels=(
    '"Take!" (execute single bead)'
    '"Scene!" (multi-bead orchestration)'
    '"Direct" (planning)'
    '"Breakdown" (decomposition)'
    '"Hydration" (quick direct)'
  )

  local i
  for ((i = 0; i < ${#action_names[@]}; i++)); do
    local chosen
    chosen="$(_prompt_action_choice "${action_labels[$i]}" "${FOUND_AGENTS[@]}")"
    _kv_set ACTION_MAP "${action_names[$i]}" "$chosen"
  done
}

# Prompt for model preferences for each found agent.
_prompt_all_models() {
  local aid
  printf '\n' >/dev/tty
  for aid in "${FOUND_AGENTS[@]}"; do
    local model
    model="$(_prompt_model "$aid")"
    _kv_set AGENT_MODELS "$aid" "$model"
  done
}

# ── Main wizard entry point ───────────────────────────────────

maybe_agent_wizard() {
  # Skip when not interactive
  if [[ ! -t 0 ]]; then
    return 0
  fi

  printf '\nWould you like Foolery to scan for and auto-register AI agents? [Y/n] '
  local answer
  read -r answer </dev/tty || true
  case "$answer" in [nN]) return 0 ;; esac

  detect_agents

  if [[ ${#FOUND_AGENTS[@]} -eq 0 ]]; then
    _wizard_log "No supported agents found on PATH. You can add them later in Settings."
    return 0
  fi

  # AGENT_MODELS and ACTION_MAP use _kv_set/_kv_get (bash 3.2-safe).
  :

  if [[ ${#FOUND_AGENTS[@]} -eq 1 ]]; then
    local sole="${FOUND_AGENTS[0]}"
    local action
    for action in take scene direct breakdown hydration; do
      _kv_set ACTION_MAP "$action" "$sole"
    done
    _wizard_log "Registered $sole as default agent for all actions."
  else
    _prompt_all_models
    _prompt_action_mappings
  fi

  _write_settings_toml
  _wizard_log "Agent settings saved to $SETTINGS_FILE"
}
