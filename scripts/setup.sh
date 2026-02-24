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

_PROMPT_MARKER="FOOLERY_GUIDANCE_PROMPT_START"

_resolve_prompt_template() {
  if [[ -n "${APP_DIR:-}" && -f "${APP_DIR}/PROMPT.md" ]]; then
    printf '%s\n' "${APP_DIR}/PROMPT.md"
    return 0
  fi

  local script_dir repo_prompt
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_prompt="$(cd "$script_dir/.." && pwd)/PROMPT.md"
  if [[ -f "$repo_prompt" ]]; then
    printf '%s\n' "$repo_prompt"
    return 0
  fi

  return 1
}

# Bash 3.2-safe key-value helpers (replaces associative arrays).
_kv_set() { eval "_KV_${1}__${2}=\$3"; }
_kv_get() { eval "printf '%s' \"\${_KV_${1}__${2}:-\$3}\""; }

_discover_models() {
  local aid="$1"
  case "$aid" in
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
  esac
}

# ---------------------------------------------------------------------------
# Repo discovery wizard
# ---------------------------------------------------------------------------

REGISTRY_DIR="${HOME}/.config/foolery"
REGISTRY_FILE="${REGISTRY_DIR}/registry.json"
KNOWN_MEMORY_MANAGERS=(beads)

_memory_manager_marker_dir() {
  case "$1" in
    beads) printf '.beads' ;;
    *) return 1 ;;
  esac
}

_supported_memory_managers_csv() {
  local joined=""
  local memory_manager
  for memory_manager in "${KNOWN_MEMORY_MANAGERS[@]}"; do
    if [[ -z "$joined" ]]; then
      joined="$memory_manager"
    else
      joined="${joined}, $memory_manager"
    fi
  done
  printf '%s' "$joined"
}

_supported_markers_csv() {
  local joined=""
  local memory_manager marker
  for memory_manager in "${KNOWN_MEMORY_MANAGERS[@]}"; do
    marker="$(_memory_manager_marker_dir "$memory_manager")"
    if [[ -z "$joined" ]]; then
      joined="$marker"
    else
      joined="${joined}, $marker"
    fi
  done
  printf '%s' "$joined"
}

_detect_memory_manager_for_repo() {
  local repo_path="$1"
  local memory_manager marker
  for memory_manager in "${KNOWN_MEMORY_MANAGERS[@]}"; do
    marker="$(_memory_manager_marker_dir "$memory_manager")"
    if [[ -d "$repo_path/$marker" ]]; then
      printf '%s' "$memory_manager"
      return 0
    fi
  done
  return 1
}

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
  local repo_path="$1" repo_name="$2" now="$3" memory_manager_type="$4"
  local tmp_file="${REGISTRY_FILE}.tmp.$$"

  if [[ -f "$REGISTRY_FILE" ]]; then
    jq --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" --arg t "$memory_manager_type" \
      '.repos += [{"path": $p, "name": $n, "addedAt": $d, "memoryManagerType": $t}]' \
      "$REGISTRY_FILE" >"$tmp_file" 2>/dev/null
  else
    jq -n --arg p "$repo_path" --arg n "$repo_name" --arg d "$now" --arg t "$memory_manager_type" \
      '{"repos": [{"path": $p, "name": $n, "addedAt": $d, "memoryManagerType": $t}]}' \
      >"$tmp_file" 2>/dev/null
  fi
  mv "$tmp_file" "$REGISTRY_FILE"
}

_write_registry_entry_sed() {
  local repo_path="$1" repo_name="$2" now="$3" memory_manager_type="$4"
  local safe_path safe_name safe_memory_manager entry
  safe_path="$(_escape_json_string "$repo_path")"
  safe_name="$(_escape_json_string "$repo_name")"
  safe_memory_manager="$(_escape_json_string "$memory_manager_type")"
  entry="$(printf '{"path": "%s", "name": "%s", "addedAt": "%s", "memoryManagerType": "%s"}' "$safe_path" "$safe_name" "$now" "$safe_memory_manager")"

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
  local repo_path="$1" memory_manager_type="$2"
  local repo_name now
  repo_name="$(basename "$repo_path")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S 2>/dev/null || date +%s)"
  mkdir -p "$REGISTRY_DIR"

  if command -v jq >/dev/null 2>&1; then
    _write_registry_entry_jq "$repo_path" "$repo_name" "$now" "$memory_manager_type"
  else
    _write_registry_entry_sed "$repo_path" "$repo_name" "$now" "$memory_manager_type"
  fi
  _append_to_registry_cache "$repo_path"
}

_display_scan_results() {
  local found_repos="$1" i=0 new_count=0
  printf '\nFound repositories:\n' >&2
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    local memory_manager_type repo_dir
    memory_manager_type="${record%%|*}"
    repo_dir="${record#*|}"
    i=$((i + 1))
    if _is_path_registered "$repo_dir"; then
      printf '  %d) %s [%s] (already mounted)\n' "$i" "$repo_dir" "$memory_manager_type" >&2
    else
      printf '  %d) %s [%s]\n' "$i" "$repo_dir" "$memory_manager_type" >&2
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
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    local memory_manager_type repo_dir
    memory_manager_type="${record%%|*}"
    repo_dir="${record#*|}"
    i=$((i + 1))

    if _is_path_registered "$repo_dir"; then
      continue
    fi

    if [[ "$choice" == "all" ]] || printf ',%s,' ",$choice," | grep -q ",$i,"; then
      _write_registry_entry "$repo_dir" "$memory_manager_type"
      _setup_log "Mounted: $repo_dir [$memory_manager_type]"
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

  local found_repos=""
  local memory_manager marker marker_dirs marker_dir repo_dir
  for memory_manager in "${KNOWN_MEMORY_MANAGERS[@]}"; do
    marker="$(_memory_manager_marker_dir "$memory_manager")"
    marker_dirs="$(find "$scan_dir" -maxdepth 3 -type d -name "$marker" 2>/dev/null | sort)"
    while IFS= read -r marker_dir; do
      [[ -z "$marker_dir" ]] && continue
      repo_dir="$(dirname "$marker_dir")"
      found_repos="$(printf '%s\n%s|%s' "$found_repos" "$memory_manager" "$repo_dir")"
    done <<EOF
$marker_dirs
EOF
  done
  found_repos="$(printf '%s\n' "$found_repos" | sed '/^$/d' | sort -u)"
  if [[ -z "$found_repos" ]]; then
    _setup_log "No compatible repositories found under $scan_dir (supported memory managers: $(_supported_memory_managers_csv); markers: $(_supported_markers_csv))"
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
    local memory_manager_type
    memory_manager_type="$(_detect_memory_manager_for_repo "$repo_path" || true)"
    if [[ -z "$memory_manager_type" ]]; then
      _setup_log "No supported memory manager found in: $repo_path (expected markers: $(_supported_markers_csv))"
      continue
    fi
    if _is_path_registered "$repo_path"; then
      _setup_log "Already mounted: $repo_path"
      continue
    fi

    _write_registry_entry "$repo_path" "$memory_manager_type"
    _setup_log "Mounted: $repo_path [$memory_manager_type]"
  done
}

_prompt_scan_method() {
  printf '\nHow would you like to find repositories?\n'
  printf '  1) Scan a directory for supported memory managers (default: ~, up to 2 levels deep)\n'
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

_append_guidance_prompt_to_file() {
  local target_file="$1" prompt_file="$2"

  if grep -Fq "$_PROMPT_MARKER" "$target_file" 2>/dev/null; then
    return 2
  fi

  printf '\n\n' >>"$target_file"
  cat "$prompt_file" >>"$target_file"
  printf '\n' >>"$target_file"
  return 0
}

_prompt_guidance_wizard() {
  local prompt_file mounted
  if ! prompt_file="$(_resolve_prompt_template)"; then
    _setup_log "Guidance prompt template unavailable; skipping prompt update."
    return 0
  fi

  mounted="$(_read_registry_paths)"
  if [[ -z "$mounted" ]]; then
    return 0
  fi

  if ! _setup_confirm "Would you like to update default prompt files with Foolery's guidance prompt? (highly recommended) [Y/n] " "y"; then
    return 0
  fi

  local updated=0 already=0 missing=0
  while IFS= read -r repo_path; do
    [[ -z "$repo_path" ]] && continue

    local found_in_repo=0
    local target_file
    for target_file in "$repo_path/AGENTS.md" "$repo_path/CLAUDE.md"; do
      if [[ ! -f "$target_file" ]]; then
        continue
      fi
      found_in_repo=1

      if _append_guidance_prompt_to_file "$target_file" "$prompt_file"; then
        _setup_log "Updated prompt guidance: $target_file"
        updated=$((updated + 1))
      else
        local code="$?"
        if [[ "$code" -eq 2 ]]; then
          already=$((already + 1))
        else
          _setup_log "Failed updating prompt guidance: $target_file"
        fi
      fi
    done

    if [[ "$found_in_repo" -eq 0 ]]; then
      missing=$((missing + 1))
    fi
  done <<EOF
$mounted
EOF

  _setup_log "Prompt guidance update complete: $updated updated, $already already present, $missing repos without AGENTS.md/CLAUDE.md."
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
      local _model
      _model="$(_kv_get AGENT_MODELS "$aid" "")"
      if [[ -n "$_model" ]]; then
        printf 'model = "%s"\n' "$_model"
      fi
      printf '\n'
    done

    printf '[actions]\n'
    local action
    for action in take scene direct breakdown; do
      printf '%s = "%s"\n' "$action" "$(_kv_get ACTION_MAP "$action" "default")"
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
  local models_list
  models_list="$(_discover_models "$aid")"

  if [[ -z "$models_list" ]]; then
    # No discovery available — free-text fallback
    local model
    printf 'Model for %s (optional, press Enter to skip): ' "$aid" >/dev/tty
    read -r model </dev/tty || true
    printf '%s' "$model"
    return
  fi

  # Build numbered menu
  local -a models=()
  while IFS= read -r m; do
    [[ -n "$m" ]] && models+=("$m")
  done <<EOF
$models_list
EOF

  local count=${#models[@]}
  printf '\nAvailable models for %s:\n' "$aid" >/dev/tty
  local i
  for ((i = 0; i < count; i++)); do
    printf '  %d) %s\n' "$((i + 1))" "${models[$i]}" >/dev/tty
  done
  printf '  %d) Skip\n' "$((count + 1))" >/dev/tty
  printf '  %d) Other (type manually)\n' "$((count + 2))" >/dev/tty

  local choice
  printf 'Choice [%d]: ' "$((count + 1))" >/dev/tty
  read -r choice </dev/tty || true
  choice="${choice:-$((count + 1))}"

  if [[ "$choice" =~ ^[0-9]+$ ]]; then
    if ((choice >= 1 && choice <= count)); then
      printf '%s' "${models[$((choice - 1))]}"
      return
    elif ((choice == count + 2)); then
      local model
      printf 'Enter model name: ' >/dev/tty
      read -r model </dev/tty || true
      printf '%s' "$model"
      return
    fi
  fi
  # Skip (default) — return empty
  printf ''
}

_prompt_action_mappings() {
  local -a action_names=(take scene direct breakdown)
  local -a action_labels=(
    '"Take!" (execute single bead)'
    '"Scene!" (multi-bead orchestration)'
    '"Direct" (planning)'
    '"Breakdown" (decomposition)'
  )

  local i
  for ((i = 0; i < ${#action_names[@]}; i++)); do
    local chosen
    chosen="$(_prompt_action_choice "${action_labels[$i]}" "${FOUND_AGENTS[@]}")"
    _kv_set ACTION_MAP "${action_names[$i]}" "$chosen"
  done
}

_prompt_all_models() {
  local aid
  printf '\n' >/dev/tty
  for aid in "${FOUND_AGENTS[@]}"; do
    local model
    model="$(_prompt_model "$aid")"
    _kv_set AGENT_MODELS "$aid" "$model"
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

  # AGENT_MODELS and ACTION_MAP use _kv_set/_kv_get (bash 3.2-safe).
  :

  if [[ ${#FOUND_AGENTS[@]} -eq 1 ]]; then
    local sole="${FOUND_AGENTS[0]}"
    local action
    for action in take scene direct breakdown; do
      _kv_set ACTION_MAP "$action" "$sole"
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
  _prompt_guidance_wizard
  _agent_wizard
  _setup_log "Setup complete."
}

# Allow direct execution: bash setup.sh
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  foolery_setup "$@"
fi
