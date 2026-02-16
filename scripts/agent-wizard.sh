#!/usr/bin/env bash
# Agent discovery wizard for Foolery install.
# Detects supported AI agents on PATH and writes multi-agent settings.
set -euo pipefail

CONFIG_DIR="${HOME}/.config/foolery"
SETTINGS_FILE="${CONFIG_DIR}/settings.toml"

# Known agents: id -> (command, label)
KNOWN_AGENTS=(claude codex gemini)
declare -A AGENT_LABELS=(
  [claude]="Claude Code"
  [codex]="OpenAI Codex"
  [gemini]="Google Gemini"
)

_wizard_log() {
  printf '[foolery-install] %s\n' "$*"
}

# ── TOML helpers ──────────────────────────────────────────────

# Read the current settings file content (empty string if missing).
_read_settings_file() {
  if [[ -f "$SETTINGS_FILE" ]]; then
    cat "$SETTINGS_FILE"
  fi
}

# Write a complete settings file from the collected state.
# Arguments: found_ids[@]  models_assoc  action_mappings_assoc
# Uses global associative arrays: AGENT_MODELS, ACTION_MAP, AGENT_LABELS
_write_settings_toml() {
  local -n _ids=$1
  mkdir -p "$CONFIG_DIR"

  local default_cmd="${_ids[0]:-claude}"
  {
    printf '[agent]\ncommand = "%s"\n\n' "$default_cmd"

    for aid in "${_ids[@]}"; do
      printf '[agents.%s]\ncommand = "%s"\nlabel = "%s"\n' \
        "$aid" "$aid" "${AGENT_LABELS[$aid]}"
      if [[ -n "${AGENT_MODELS[$aid]:-}" ]]; then
        printf 'model = "%s"\n' "${AGENT_MODELS[$aid]}"
      fi
      printf '\n'
    done

    printf '[actions]\n'
    local action
    for action in take scene direct breakdown hydration; do
      printf '%s = "%s"\n' "$action" "${ACTION_MAP[$action]:-default}"
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
      local path
      path="$(command -v "$aid")"
      _wizard_log "  Found: $aid (at $path)"
      FOUND_AGENTS+=("$aid")
    fi
  done
}

# ── Prompts ───────────────────────────────────────────────────

# Ask the user which agent to use for a given action.
# Prints the chosen agent id to stdout.
_prompt_action_choice() {
  local action_label="$1"
  shift
  local agents=("$@")
  local count=${#agents[@]}

  printf '\nWhich agent for "%s"?\n' "$action_label"
  local i
  for ((i = 0; i < count; i++)); do
    printf '  %d) %s\n' "$((i + 1))" "${agents[$i]}"
  done

  local choice
  printf 'Choice [1]: '
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
  printf 'Model for %s (optional, press Enter to skip): ' "$aid"
  read -r model </dev/tty || true
  printf '%s' "$model"
}

# Prompt for per-action agent mappings (multiple agents).
_prompt_action_mappings() {
  local -n _agents=$1
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
    chosen="$(_prompt_action_choice "${action_labels[$i]}" "${_agents[@]}")"
    ACTION_MAP[${action_names[$i]}]="$chosen"
  done
}

# Prompt for model preferences for each found agent.
_prompt_all_models() {
  local -n _agents=$1
  local aid
  printf '\n'
  for aid in "${_agents[@]}"; do
    local model
    model="$(_prompt_model "$aid")"
    AGENT_MODELS[$aid]="$model"
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
  if [[ "${answer,,}" == "n" ]]; then
    return 0
  fi

  detect_agents

  if [[ ${#FOUND_AGENTS[@]} -eq 0 ]]; then
    _wizard_log "No supported agents found on PATH. You can add them later in Settings."
    return 0
  fi

  # Shared state for TOML generation
  declare -A AGENT_MODELS=()
  declare -A ACTION_MAP=()

  if [[ ${#FOUND_AGENTS[@]} -eq 1 ]]; then
    local sole="${FOUND_AGENTS[0]}"
    for action in take scene direct breakdown hydration; do
      ACTION_MAP[$action]="$sole"
    done
    _wizard_log "Registered $sole as default agent for all actions."
  else
    _prompt_all_models FOUND_AGENTS
    _prompt_action_mappings FOUND_AGENTS
  fi

  _write_settings_toml FOUND_AGENTS
  _wizard_log "Agent settings saved to $SETTINGS_FILE"
}
