#!/usr/bin/env bash
# foolery setup — interactive post-install configuration.
# Runs repo discovery and agent discovery wizards.
#
# Designed to be sourced by the foolery launcher; expects INSTALL_ROOT
# and standard foolery env vars to be set by the caller.

set -euo pipefail

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_setup_log() {
  printf '[foolery] %s\n' "$*"
}

_setup_confirm() {
  local prompt="$1" default="${2:-y}"
  local answer
  read -r -p "$prompt" answer </dev/tty || answer=""
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Repo discovery wizard
# ---------------------------------------------------------------------------

REGISTRY_DIR="${HOME}/.config/foolery"
REGISTRY_FILE="${REGISTRY_DIR}/registry.json"

_read_registry_paths() {
  if [[ ! -f "$REGISTRY_FILE" ]]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.repos[]?.path // empty' "$REGISTRY_FILE" 2>/dev/null || true
  else
    tr '{' '\n' <"$REGISTRY_FILE" 2>/dev/null \
      | sed -nE 's/.*"path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
      || true
  fi
}

_REGISTRY_CACHE=""
_REGISTRY_CACHE_VALID=0

_refresh_registry_cache() {
  _REGISTRY_CACHE="$(_read_registry_paths)"
  _REGISTRY_CACHE_VALID=1
}

_invalidate_registry_cache() {
  _REGISTRY_CACHE_VALID=0
}

_append_to_registry_cache() {
  local path="$1"
  if [[ "$_REGISTRY_CACHE_VALID" -ne 1 ]]; then
    _refresh_registry_cache
  fi
  if [[ -z "$_REGISTRY_CACHE" ]]; then
    _REGISTRY_CACHE="$path"
  else
    _REGISTRY_CACHE="$(printf '%s\n%s' "$_REGISTRY_CACHE" "$path")"
  fi
}

_is_path_registered() {
  local target="$1"
  if [[ "$_REGISTRY_CACHE_VALID" -ne 1 ]]; then
    _refresh_registry_cache
  fi
  if [[ -z "$_REGISTRY_CACHE" ]]; then
    return 1
  fi
  printf '%s\n' "$_REGISTRY_CACHE" | grep -qxF "$target"
}

_show_mounted_repos() {
  local mounted
  mounted="$(_read_registry_paths)"
  if [[ -z "$mounted" ]]; then
    return 1
  fi
  printf '\nThe following clones are already mounted:\n'
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    printf '  - %s (%s)\n' "$p" "$(basename "$p")"
  done <<EOF
$mounted
EOF
  return 0
}

_escape_json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

_write_registry_entry_jq() {
  local repo_path="$1" repo_name="$2" now="$3"
  local tmp_file="${REGISTRY_FILE}.tmp.$$"

  if [[ -f "$REGISTRY_FILE" ]]; then
    jq --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" \
      '.repos += [{"path": $p, "name": $n, "addedAt": $d}]' \
      "$REGISTRY_FILE" >"$tmp_file" 2>/dev/null
  else
    jq -n --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" \
      '{"repos": [{"path": $p, "name": $n, "addedAt": $d}]}' \
      >"$tmp_file" 2>/dev/null
  fi
  mv "$tmp_file" "$REGISTRY_FILE"
}

_write_registry_entry_sed() {
  local repo_path="$1" repo_name="$2" now="$3"
  local safe_path safe_name entry
  safe_path="$(_escape_json_string "$repo_path")"
  safe_name="$(_escape_json_string "$repo_name")"
  entry="$(printf '{"path": "%s", "name": "%s", "addedAt": "%s"}' "$safe_path" "$safe_name" "$now")"

  if [[ ! -f "$REGISTRY_FILE" ]]; then
    printf '{"repos": [%s]}\n' "$entry" >"$REGISTRY_FILE"
    return 0
  fi

  local content
  content="$(tr -d '\n' <"$REGISTRY_FILE")"
  local prefix
  prefix="${content%\]*}"
  if [[ "$prefix" == "$content" ]]; then
    printf '{"repos": [%s]}\n' "$entry" >"$REGISTRY_FILE"
    return 0
  fi
  printf '%s,%s]}\n' "$prefix" "$entry" >"$REGISTRY_FILE"
}

_write_registry_entry() {
  local repo_path="$1"
  local repo_name now
  repo_name="$(basename "$repo_path")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%s)"
  mkdir -p "$REGISTRY_DIR"

  if command -v jq >/dev/null 2>&1; then
    _write_registry_entry_jq "$repo_path" "$repo_name" "$now"
  else
    _write_registry_entry_sed "$repo_path" "$repo_name" "$now"
  fi
  _append_to_registry_cache "$repo_path"
}

_display_scan_results() {
  local found_repos="$1" i=0 new_count=0
  printf '\nFound repositories:\n' >&2
  while IFS= read -r beads_dir; do
    [[ -z "$beads_dir" ]] && continue
    local repo_dir
    repo_dir="$(dirname "$beads_dir")"
    i=$((i + 1))
    if _is_path_registered "$repo_dir"; then
      printf '  %d) %s (already mounted)\n' "$i" "$repo_dir" >&2
    else
      printf '  %d) %s\n' "$i" "$repo_dir" >&2
      new_count=$((new_count + 1))
    fi
  done <<EOF
$found_repos
EOF
  printf '%d\n' "$new_count"
}

_mount_selected_repos() {
  local found_repos="$1" choice
  read -r -p "Enter numbers to mount (comma-separated, or 'all') [all]: " choice </dev/tty || choice=""
  choice="${choice:-all}"
  choice="${choice// /}"

  local i=0
  while IFS= read -r beads_dir; do
    [[ -z "$beads_dir" ]] && continue
    local repo_dir
    repo_dir="$(dirname "$beads_dir")"
    i=$((i + 1))

    if _is_path_registered "$repo_dir"; then
      continue
    fi

    if [[ "$choice" == "all" ]] || printf ',%s,' ",$choice," | grep -q ",$i,"; then
      _write_registry_entry "$repo_dir"
      _setup_log "Mounted: $repo_dir"
    fi
  done <<EOF
$found_repos
EOF
}

_scan_and_mount_repos() {
  local scan_dir="$1"
  if [[ ! -d "$scan_dir" ]]; then
    _setup_log "Directory does not exist: $scan_dir"
    return 0
  fi

  local found_repos
  found_repos="$(find "$scan_dir" -maxdepth 3 -type d -name '.beads' 2>/dev/null | sort)"
  if [[ -z "$found_repos" ]]; then
    _setup_log "No repositories with .beads/ found under $scan_dir"
    return 0
  fi

  local new_count
  new_count="$(_display_scan_results "$found_repos")"

  if [[ "$new_count" -eq 0 ]]; then
    _setup_log "All found repositories are already mounted."
    return 0
  fi

  _mount_selected_repos "$found_repos"
}

_handle_manual_entry() {
  while true; do
    local repo_path
    read -r -p "Enter repository path (or empty to finish): " repo_path </dev/tty || break
    if [[ -z "$repo_path" ]]; then
      break
    fi

    case "$repo_path" in
      "~"*) repo_path="${HOME}${repo_path#"~"}" ;;
    esac

    if [[ ! -d "$repo_path" ]]; then
      _setup_log "Path does not exist or is not a directory: $repo_path"
      continue
    fi
    if [[ ! -d "$repo_path/.beads" ]]; then
      _setup_log "No .beads/ directory found in: $repo_path"
      continue
    fi
    if _is_path_registered "$repo_path"; then
      _setup_log "Already mounted: $repo_path"
      continue
    fi

    _write_registry_entry "$repo_path"
    _setup_log "Mounted: $repo_path"
  done
}

_prompt_scan_method() {
  printf '\nHow would you like to find repositories?\n'
  printf '  1) Scan a directory (default: ~, up to 2 levels deep)\n'
  printf '  2) Manually specify paths\n'
  local method
  read -r -p "Choice [1]: " method </dev/tty || method=""
  method="${method:-1}"

  case "$method" in
    1)
      local scan_dir
      read -r -p "Directory to scan [$HOME]: " scan_dir </dev/tty || scan_dir=""
      scan_dir="${scan_dir:-$HOME}"
      case "$scan_dir" in
        "~"*) scan_dir="${HOME}${scan_dir#"~"}" ;;
      esac
      _scan_and_mount_repos "$scan_dir"
      ;;
    2)
      _handle_manual_entry
      ;;
    *)
      _setup_log "Invalid choice: $method"
      ;;
  esac
}

_repo_wizard() {
  printf '\n'
  if ! _setup_confirm "Would you like to mount existing local repo clones? (You probably do) [Y/n] " "y"; then
    return 0
  fi

  if _show_mounted_repos; then
    if ! _setup_confirm "Are there others you'd like to add? [Y/n] " "y"; then
      return 0
    fi
  fi

  _prompt_scan_method
}

# ---------------------------------------------------------------------------
# Agent discovery wizard
# ---------------------------------------------------------------------------

_AGENT_CONFIG_DIR="${HOME}/.config/foolery"
_AGENT_SETTINGS_FILE="${_AGENT_CONFIG_DIR}/settings.toml"
KNOWN_AGENTS=(claude codex gemini)

_agent_label() {
  case "$1" in
    claude) printf 'Claude Code' ;;
    codex)  printf 'OpenAI Codex' ;;
    gemini) printf 'Google Gemini' ;;
    *)      printf '%s' "$1" ;;
  esac
}

_write_settings_toml() {
  mkdir -p "$_AGENT_CONFIG_DIR"

  local default_cmd="${FOUND_AGENTS[0]:-claude}"
  {
    printf '[agent]\ncommand = "%s"\n\n' "$default_cmd"

    local aid
    for aid in "${FOUND_AGENTS[@]}"; do
      local lbl
      lbl="$(_agent_label "$aid")"
      printf '[agents.%s]\ncommand = "%s"\nlabel = "%s"\n' \
        "$aid" "$aid" "$lbl"
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
  } > "$_AGENT_SETTINGS_FILE"
}

_detect_agents() {
  FOUND_AGENTS=()
  local aid
  for aid in "${KNOWN_AGENTS[@]}"; do
    if command -v "$aid" >/dev/null 2>&1; then
      local agent_path
      agent_path="$(command -v "$aid")"
      _setup_log "  Found: $aid (at $agent_path)"
      FOUND_AGENTS+=("$aid")
    fi
  done
}

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

_prompt_model() {
  local aid="$1"
  local model
  printf 'Model for %s (optional, press Enter to skip): ' "$aid" >/dev/tty
  read -r model </dev/tty || true
  printf '%s' "$model"
}

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
    ACTION_MAP[${action_names[$i]}]="$chosen"
  done
}

_prompt_all_models() {
  local aid
  printf '\n' >/dev/tty
  for aid in "${FOUND_AGENTS[@]}"; do
    local model
    model="$(_prompt_model "$aid")"
    AGENT_MODELS[$aid]="$model"
  done
}

_agent_wizard() {
  printf '\n'
  if ! _setup_confirm "Would you like Foolery to scan for and auto-register AI agents? [Y/n] " "y"; then
    return 0
  fi

  _detect_agents

  if [[ ${#FOUND_AGENTS[@]} -eq 0 ]]; then
    _setup_log "No supported agents found on PATH. You can add them later in Settings."
    return 0
  fi

  declare -A AGENT_MODELS=()
  declare -A ACTION_MAP=()

  if [[ ${#FOUND_AGENTS[@]} -eq 1 ]]; then
    local sole="${FOUND_AGENTS[0]}"
    local action
    for action in take scene direct breakdown hydration; do
      ACTION_MAP[$action]="$sole"
    done
    _setup_log "Registered $sole as default agent for all actions."
  else
    _prompt_all_models
    _prompt_action_mappings
  fi

  _write_settings_toml
  _setup_log "Agent settings saved to $_AGENT_SETTINGS_FILE"
}

# ---------------------------------------------------------------------------
# Main entry point — run both wizards
# ---------------------------------------------------------------------------

foolery_setup() {
  if [[ ! -t 0 ]]; then
    printf '[foolery] setup requires an interactive terminal.\n' >&2
    return 1
  fi

  _setup_log "Foolery interactive setup"
  _repo_wizard
  _agent_wizard
  _setup_log "Setup complete."
}

# Allow direct execution: bash setup.sh
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  foolery_setup "$@"
fi
