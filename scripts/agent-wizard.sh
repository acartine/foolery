#!/usr/bin/env bash
# Agent discovery wizard for Foolery install.
# Detects supported AI agents on PATH and writes multi-agent settings.
#
# Designed to be sourced by install.sh; compatible with Bash 3.2+
# (macOS default) — no associative arrays or bash 4+ expansions.

CONFIG_DIR="${HOME}/.config/foolery"
SETTINGS_FILE="${CONFIG_DIR}/settings.toml"

_WIZARD_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=model-picker.sh
source "${_WIZARD_SCRIPT_DIR}/model-picker.sh"
# shellcheck source=toml-reader.sh
source "${_WIZARD_SCRIPT_DIR}/toml-reader.sh"

# Configurable I/O for testability — override to redirect prompts.
_SETUP_INPUT="${_SETUP_INPUT:-/dev/tty}"
_SETUP_OUTPUT="${_SETUP_OUTPUT:-/dev/tty}"

# Known agent ids checked during detection.
KNOWN_AGENTS=(claude copilot codex gemini opencode)

_wizard_supports_color() {
  if [[ -n "${NO_COLOR:-}" || -n "${CI:-}" || "${TERM:-}" == "dumb" ]]; then
    return 1
  fi
  [[ -t 1 ]]
}

_wizard_supports_emoji() {
  local locale="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
  [[ -t 1 ]] || return 1
  [[ "$locale" == *UTF-8* || "$locale" == *utf8* ]]
}

_wizard_color() {
  case "$1" in
    cyan) printf '\033[1;36m' ;;
    blue) printf '\033[1;34m' ;;
    green) printf '\033[1;32m' ;;
    reset) printf '\033[0m' ;;
  esac
}

_wizard_icon() {
  local kind="$1"
  if _wizard_supports_emoji; then
    case "$kind" in
      heading) printf '✨' ;;
      prompt) printf '👉' ;;
      found) printf '🤖' ;;
      success) printf '✅' ;;
      *) printf 'ℹ️' ;;
    esac
    return 0
  fi

  case "$kind" in
    heading) printf '==>' ;;
    prompt) printf '%s' '->' ;;
    found) printf '[agent]' ;;
    success) printf '[ok]' ;;
    *) printf '[i]' ;;
  esac
}

_wizard_prefix() {
  local kind="${1:-info}" color=""
  if _wizard_supports_color; then
    case "$kind" in
      success) color="$(_wizard_color green)" ;;
      heading|prompt) color="$(_wizard_color blue)" ;;
      *) color="$(_wizard_color cyan)" ;;
    esac
  fi

  if [[ -n "$color" ]]; then
    printf '%b[foolery-install]%b %s' "$color" "$(_wizard_color reset)" "$(_wizard_icon "$kind")"
  else
    printf '[foolery-install] %s' "$(_wizard_icon "$kind")"
  fi
}

_wizard_log() {
  printf '%s %s\n' "$(_wizard_prefix info)" "$*"
}

_wizard_success() {
  printf '%s %s\n' "$(_wizard_prefix success)" "$*"
}

_wizard_heading() {
  printf '\n%s %s\n' "$(_wizard_prefix heading)" "$1" >"$_SETUP_OUTPUT"
}

_wizard_prompt() {
  printf '%s %s' "$(_wizard_prefix prompt)" "$1" >"$_SETUP_OUTPUT"
}

# Bash 3.2-safe key-value helpers (replaces associative arrays).
_kv_key() {
  printf '%s' "$2" | sed 's/[^A-Za-z0-9_]/_/g'
}
_kv_set() {
  local key
  key="$(_kv_key "$1" "$2")"
  eval "_KV_${1}__${key}=\$3"
}
_kv_get() {
  local key
  key="$(_kv_key "$1" "$2")"
  eval "printf '%s' \"\${_KV_${1}__${key}:-\$3}\""
}

_slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//'
}

_append_unique() {
  local value="$1"
  shift
  local existing
  for existing in "$@"; do
    [[ "$existing" == "$value" ]] && return 1
  done
  return 0
}

_configured_model() {
  local aid="$1"
  case "$aid" in
    copilot)
      local config="$HOME/.copilot/config.json"
      if [[ -f "$config" ]]; then
        if command -v jq >/dev/null 2>&1; then
          jq -r '.model // .defaultModel // .selectedModel // empty' \
            "$config" 2>/dev/null
        else
          sed -nE \
            's/.*"(model|defaultModel|selectedModel)"[[:space:]]*:[[:space:]]*"([^"]*)".*/\2/p' \
            "$config" | head -n 1
        fi
      fi
      ;;
  esac
}

_discover_models() {
  local aid="$1"
  case "$aid" in
    copilot)
      _configured_model "$aid"
      printf '%s\n' \
        claude-sonnet-4.5 \
        claude-haiku-4.5 \
        gpt-5.3-codex \
        gpt-5.2 \
        gemini-2.5-pro
      ;;
    codex)
      local cache="$HOME/.codex/models_cache.json"
      if [[ -f "$cache" ]]; then
        if command -v jq >/dev/null 2>&1; then
          jq -r '.models[] | select(.visibility=="list") | .slug' "$cache" 2>/dev/null
        else
          sed -n 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cache"
        fi
      fi
      ;;
    claude)
      printf '%s\n' sonnet opus haiku
      ;;
    gemini)
      printf '%s\n' gemini-2.5-pro gemini-2.5-flash
      ;;
    opencode)
      opencode models 2>/dev/null
      ;;
  esac
}

# Return the human-readable label for a known agent id.
_agent_label() {
  case "$1" in
    claude) printf 'Claude Code' ;;
    copilot) printf 'GitHub Copilot' ;;
    codex)  printf 'OpenAI Codex' ;;
    gemini) printf 'Google Gemini' ;;
    opencode) printf 'OpenCode' ;;
    *)      printf '%s' "$1" ;;
  esac
}

# ── TOML writer ───────────────────────────────────────────────

# Write a complete settings file from the collected state.
# Reads from globals: REGISTERED_AGENTS; uses _kv_get for AGENT_* / ACTION_MAP.
_DEFAULT_SCOPE_REFINEMENT_PROMPT='You are refining a newly created engineering work item.
Tighten the title, rewrite the description for clarity, and define or tighten acceptance criteria.
Keep the scope unchanged. Do not broaden the request or add speculative work.

Current beat:
Title: {{title}}
Description:
{{description}}

Acceptance criteria:
{{acceptance}}
'

_needs_quoting() {
  case "$1" in
    *[.\ ]*) return 0 ;;
    *) return 1 ;;
  esac
}

_emit_agent_toml() {
  local aid="$1"
  local qid="$aid"
  if _needs_quoting "$aid"; then
    qid="\"$aid\""
  fi
  local cmd lbl
  cmd="$(_kv_get AGENT_COMMANDS "$aid" "$aid")"
  lbl="$(_kv_get AGENT_LABELS "$aid" "$(_agent_label "$aid")")"
  printf '[agents.%s]\ncommand = "%s"\nlabel = "%s"\n' \
    "$qid" "$cmd" "$lbl"

  local field val
  for field in model agent_type vendor provider \
    agent_name lease_model flavor version; do
    local kv_ns=""
    case "$field" in
      model) kv_ns="AGENT_MODELS" ;;
      agent_type) kv_ns="AGENT_TYPES" ;;
      vendor) kv_ns="AGENT_VENDORS" ;;
      provider) kv_ns="AGENT_PROVIDERS" ;;
      agent_name) kv_ns="AGENT_NAMES" ;;
      lease_model) kv_ns="AGENT_LEASE_MODELS" ;;
      flavor) kv_ns="AGENT_FLAVORS" ;;
      version) kv_ns="AGENT_VERSIONS" ;;
    esac
    val="$(_kv_get "$kv_ns" "$aid" "")"
    if [[ -n "$val" ]]; then
      printf '%s = "%s"\n' "$field" "$val"
    fi
  done
  printf '\n'
}

_write_settings_toml() {
  mkdir -p "$CONFIG_DIR"

  {
    local dm
    dm="$(_kv_get DISPATCH dispatch_mode "basic")"
    printf 'dispatchMode = "%s"\n' "$dm"

    local mcs mcq
    mcs="$(_kv_get DEFAULTS max_concurrent_sessions "5")"
    mcq="$(_kv_get DEFAULTS max_claims_per_queue_type "10")"
    printf 'maxConcurrentSessions = %d\n' "$mcs"
    printf 'maxClaimsPerQueueType = %d\n' "$mcq"

    local tlt
    tlt="$(_kv_get DEFAULTS terminal_light_theme "")"
    if [[ "$tlt" == "true" ]]; then
      printf 'terminalLightTheme = true\n'
    fi
    printf '\n'

    local registered_agents=()
    if [[ "${REGISTERED_AGENTS+set}" == "set" \
      && ${#REGISTERED_AGENTS[@]} -gt 0 ]]; then
      registered_agents=("${REGISTERED_AGENTS[@]}")
    else
      registered_agents=("${FOUND_AGENTS[@]}")
    fi

    local aid
    for aid in "${registered_agents[@]}"; do
      _emit_agent_toml "$aid"
    done

    printf '[actions]\n'
    local action
    for action in take scene breakdown scopeRefinement; do
      printf '%s = "%s"\n' "$action" \
        "$(_kv_get ACTION_MAP "$action" "")"
    done

    local bt
    bt="$(_kv_get BACKEND type "auto")"
    printf '\n[backend]\ntype = "%s"\n' "$bt"

    local pid
    pid="$(_kv_get DEFAULTS_SECTION profileId "")"
    local interactive_timeout_minutes
    interactive_timeout_minutes="$(_kv_get DEFAULTS_SECTION interactiveSessionTimeoutMinutes "10")"
    printf '\n[defaults]\nprofileId = "%s"\ninteractiveSessionTimeoutMinutes = %s\n' \
      "$pid" "$interactive_timeout_minutes"

    printf '\n[scopeRefinement]\n'
    local prompt
    prompt="${_SCOPE_PROMPT:-$_DEFAULT_SCOPE_REFINEMENT_PROMPT}"
    printf 'prompt = """\n%s"""\n' "$prompt"

    printf '\n[pools]\n'
    if [[ "$dm" == "advanced" ]]; then
      local step
      for step in planning plan_review implementation \
        implementation_review shipment shipment_review \
        scope_refinement; do
        local count
        count="$(_kv_get POOL_COUNT "$step" "0")"
        if [[ "$count" -eq 0 ]]; then
          printf '%s = []\n' "$step"
        fi
      done
      for step in planning plan_review implementation \
        implementation_review shipment shipment_review \
        scope_refinement; do
        local count
        count="$(_kv_get POOL_COUNT "$step" "0")"
        if [[ "$count" -gt 0 ]]; then
          printf '\n'
          local j
          for ((j = 0; j < count; j++)); do
            local agent_id weight
            agent_id="$(_kv_get "POOL_AGENT_${step}" \
              "$j" "")"
            weight="$(_kv_get "POOL_WEIGHT_${step}" \
              "$agent_id" "1")"
            printf '[[pools.%s]]\nagentId = "%s"\nweight = %d\n' \
              "$step" "$agent_id" "$weight"
          done
        fi
      done
    else
      local step
      for step in planning plan_review implementation \
        implementation_review shipment shipment_review \
        scope_refinement; do
        printf '%s = []\n' "$step"
      done
    fi
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
      printf '%s Found: %s (at %s)\n' "$(_wizard_prefix found)" "$aid" "$agent_path"
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
  local current_agent="$2"
  shift 2
  local agents=("$@")
  local count=${#agents[@]}

  # Find the index of the currently mapped agent (1-based).
  local default_idx=1 i
  for ((i = 0; i < count; i++)); do
    if [[ "${agents[$i]}" == "$current_agent" ]]; then
      default_idx=$((i + 1))
      break
    fi
  done

  _wizard_heading "Which agent for \"$action_label\"?"
  for ((i = 0; i < count; i++)); do
    local marker=""
    if [[ $((i + 1)) -eq "$default_idx" ]]; then
      marker=" (current)"
    fi
    printf '  %d) %s%s\n' "$((i + 1))" \
      "${agents[$i]}" "$marker" >"$_SETUP_OUTPUT"
  done

  local choice
  _wizard_prompt "Choice [$default_idx]: "
  read -r choice || true
  choice="${choice:-$default_idx}"

  if [[ "$choice" =~ ^[0-9]+$ ]] \
    && ((choice >= 1 && choice <= count)); then
    printf '%s' "${agents[$((choice - 1))]}"
  else
    printf '%s' "${agents[$((default_idx - 1))]}"
  fi
}

_agent_option_id() {
  local aid="$1" model="$2"
  local slug
  slug="$(_slugify "$model")"
  if [[ -n "$slug" ]]; then
    printf '%s-%s' "$aid" "$slug"
  else
    printf '%s' "$aid"
  fi
}

_register_agent_entry() {
  local id="$1" command="$2" label="$3" model="${4:-}"
  REGISTERED_AGENTS+=("$id")
  _kv_set AGENT_COMMANDS "$id" "$command"
  _kv_set AGENT_LABELS "$id" "$label"
  _kv_set AGENT_MODELS "$id" "$model"
}

_register_default_agent() {
  local aid="$1"
  _register_agent_entry "$aid" "$aid" "$(_agent_label "$aid")" "${2:-}"
}

_register_model_agents() {
  local aid="$1"
  shift
  if [[ $# -eq 0 ]]; then
    _register_default_agent "$aid"
    return
  fi

  local model
  for model in "$@"; do
    _register_agent_entry \
      "$(_agent_option_id "$aid" "$model")" \
      "$aid" \
      "$(_agent_label "$aid")" \
      "$model"
  done
}

_prompt_model_manual() {
  local aid="$1" prompt="${2:-}"
  local model
  if [[ -n "$prompt" ]]; then
    _wizard_prompt "$prompt"
  else
    _wizard_prompt "Model for $aid (optional, press Enter to skip): "
  fi
  read -r model || true
  printf '%s' "$model"
}

_collect_discovered_models() {
  local aid="$1"
  local models_list
  models_list="$(_discover_models "$aid")"

  if [[ -z "$models_list" ]]; then
    _prompt_model_manual "$aid"
    return
  fi

  local -a models=()
  while IFS= read -r m; do
    if [[ -n "$m" ]] && \
      ([[ ${#models[@]} -eq 0 ]] || _append_unique "$m" "${models[@]}"); then
      models+=("$m")
    fi
  done <<EOF
$models_list
EOF

  if ((${#models[@]} > _MODEL_SEARCH_THRESHOLD)); then
    _model_search_pick _wizard_heading _wizard_prompt \
      _prompt_model_manual "$aid" "${models[@]}"
    return
  fi

  local -a selected=()
  while true; do
    local -a remaining=()
    local model
    for model in "${models[@]}"; do
      if [[ ${#selected[@]} -eq 0 ]] || \
        _append_unique "$model" "${selected[@]}"; then
        remaining+=("$model")
      fi
    done

    local count=${#remaining[@]}
    _wizard_heading "Available models for $aid"
    local i
    for ((i = 0; i < count; i++)); do
      printf '  %d) %s\n' "$((i + 1))" "${remaining[$i]}" >"$_SETUP_OUTPUT"
    done
    printf '  %d) Done\n' "$((count + 1))" >"$_SETUP_OUTPUT"
    printf '  %d) Other (type manually)\n' "$((count + 2))" >"$_SETUP_OUTPUT"

    local choice
    _wizard_prompt "Choice [$((count + 1))]: "
    read -r choice || true
    choice="${choice:-$((count + 1))}"

    if [[ "$choice" =~ ^[0-9]+$ ]]; then
      if ((choice >= 1 && choice <= count)); then
        selected+=("${remaining[$((choice - 1))]}")
        continue
      fi
      if ((choice == count + 2)); then
        model="$(_prompt_model_manual "$aid" \
          'Enter model name (optional): ')"
        if [[ -n "$model" ]] && \
          ([[ ${#selected[@]} -eq 0 ]] || \
            _append_unique "$model" "${selected[@]}"); then
          selected+=("$model")
        fi
      fi
    fi
    break
  done

  if [[ ${#selected[@]} -gt 0 ]]; then
    printf '%s\n' "${selected[@]}"
  fi
}

# Prompt for per-action agent mappings (multiple agents).
_prompt_action_mappings() {
  local -a action_names=(take scene breakdown)
  local -a action_labels=(
    '"Take!" (execute single beat)'
    '"Scene!" (multi-beat orchestration)'
    '"Breakdown" (decomposition)'
  )

  local i
  for ((i = 0; i < ${#action_names[@]}; i++)); do
    local current
    current="$(_kv_get ACTION_MAP "${action_names[$i]}" "")"
    local chosen
    chosen="$(_prompt_action_choice \
      "${action_labels[$i]}" "$current" \
      "${REGISTERED_AGENTS[@]}")"
    _kv_set ACTION_MAP "${action_names[$i]}" "$chosen"
  done
}

# Prompt for model preferences for each found agent.
_register_scanned_agents() {
  local aid
  printf '\n' >"$_SETUP_OUTPUT"
  for aid in "${FOUND_AGENTS[@]}"; do
    local models_list
    models_list="$(_collect_discovered_models "$aid")"
    local -a selected=()
    local model
    while IFS= read -r model; do
      [[ -n "$model" ]] && selected+=("$model")
    done <<EOF
$models_list
EOF
    if [[ ${#selected[@]} -gt 0 ]]; then
      _register_model_agents "$aid" "${selected[@]}"
    fi
  done
}

# ── Main wizard entry point ───────────────────────────────────

maybe_agent_wizard() {
  # Skip when not interactive
  if [[ ! -t 0 ]]; then
    return 0
  fi

  # Load existing configuration so new agents are merged in
  _read_settings_toml "$SETTINGS_FILE"

  if [[ "$_TOML_LOADED" -eq 1 \
    && ${#REGISTERED_AGENTS[@]} -gt 0 ]]; then
    _wizard_heading "Current registered agents:"
    local _ea
    for _ea in "${REGISTERED_AGENTS[@]}"; do
      local _elbl _emod
      _elbl="$(_kv_get AGENT_LABELS "$_ea" "$_ea")"
      _emod="$(_kv_get AGENT_MODELS "$_ea" "")"
      if [[ -n "$_emod" ]]; then
        printf '  - %s (%s, model: %s)\n' \
          "$_ea" "$_elbl" "$_emod" >"$_SETUP_OUTPUT"
      else
        printf '  - %s (%s)\n' "$_ea" "$_elbl" >"$_SETUP_OUTPUT"
      fi
    done
  fi

  printf '\n' >"$_SETUP_OUTPUT"
  _wizard_prompt 'Scan for and auto-register AI agents? [Y/n] '
  local answer
  read -r answer || true
  case "$answer" in [nN])
    # Even if skipped, write back loaded config to preserve it
    if [[ "$_TOML_LOADED" -eq 1 ]]; then
      _write_settings_toml
    fi
    return 0
    ;;
  esac

  detect_agents

  if [[ ${#FOUND_AGENTS[@]} -eq 0 ]]; then
    _wizard_log "No supported agents found on PATH. You can add them later in Settings."
    if [[ "$_TOML_LOADED" -eq 1 ]]; then
      _write_settings_toml
    fi
    return 0
  fi

  # Do NOT reset REGISTERED_AGENTS — keep existing agents loaded
  # from settings.toml. New agents will be appended.

  if [[ ${#FOUND_AGENTS[@]} -eq 1 ]]; then
    local sole="${FOUND_AGENTS[0]}"
    local detected_model
    detected_model="$(_configured_model "$sole")"
    # Only register if not already present
    local _already_registered=0 _ex
    for _ex in "${REGISTERED_AGENTS[@]}"; do
      if [[ "$_ex" == "$sole" ]]; then
        _already_registered=1
        break
      fi
    done
    if [[ "$_already_registered" -eq 0 ]]; then
      _register_default_agent "$sole" "$detected_model"
    fi
    # Only set action mappings if not already configured
    local action
    for action in take scene breakdown; do
      local existing
      existing="$(_kv_get ACTION_MAP "$action" "")"
      if [[ -z "$existing" ]]; then
        _kv_set ACTION_MAP "$action" "$sole"
      fi
    done
    _wizard_success "Registered $sole for all actions."
  else
    _register_scanned_agents
    _prompt_action_mappings
  fi

  _write_settings_toml
  _wizard_success "Agent settings saved to $SETTINGS_FILE"
}
