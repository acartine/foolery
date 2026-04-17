#!/usr/bin/env bash
# foolery setup — interactive post-install configuration.
# Runs repo discovery and agent discovery wizards.
#
# Designed to be sourced by the foolery launcher; expects INSTALL_ROOT
# and standard foolery env vars to be set by the caller.

set -euo pipefail

SETUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HAS_MODEL_PICKER=0
if [[ -f "${SETUP_SCRIPT_DIR}/model-picker.sh" ]]; then
  # shellcheck source=model-picker.sh
  source "${SETUP_SCRIPT_DIR}/model-picker.sh"
  _HAS_MODEL_PICKER=1
fi
# shellcheck source=toml-reader.sh
source "${SETUP_SCRIPT_DIR}/toml-reader.sh"

# Configurable I/O for testability — override to redirect prompts.
_SETUP_INPUT="${_SETUP_INPUT:-/dev/tty}"
_SETUP_OUTPUT="${_SETUP_OUTPUT:-/dev/tty}"

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_setup_supports_color() {
  local fd="${1:-1}"
  if [[ -n "${NO_COLOR:-}" || -n "${CI:-}" || "${TERM:-}" == "dumb" ]]; then
    return 1
  fi
  if [[ "$fd" == "2" ]]; then
    [[ -t 2 ]]
  else
    [[ -t 1 ]]
  fi
}

_setup_supports_emoji() {
  local fd="${1:-1}"
  local locale="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
  if [[ "$locale" != *UTF-8* && "$locale" != *utf8* ]]; then
    return 1
  fi
  if [[ "$fd" == "2" ]]; then
    [[ -t 2 ]]
  else
    [[ -t 1 ]]
  fi
}

_setup_color() {
  case "$1" in
    blue) printf '\033[1;34m' ;;
    green) printf '\033[1;32m' ;;
    yellow) printf '\033[1;33m' ;;
    cyan) printf '\033[1;36m' ;;
    red) printf '\033[1;31m' ;;
    reset) printf '\033[0m' ;;
  esac
}

_setup_icon() {
  local kind="$1" fd="${2:-1}"
  if _setup_supports_emoji "$fd"; then
    case "$kind" in
      heading) printf '✨' ;;
      prompt) printf '👉' ;;
      repo) printf '📁' ;;
      success) printf '✅' ;;
      warn) printf '⚠️' ;;
      error) printf '❌' ;;
      *) printf 'ℹ️' ;;
    esac
    return 0
  fi

  case "$kind" in
    heading) printf '==>' ;;
    prompt) printf '%s' '->' ;;
    repo) printf '[repo]' ;;
    success) printf '[ok]' ;;
    warn) printf '[!]' ;;
    error) printf '[x]' ;;
    *) printf '[i]' ;;
  esac
}

_setup_emit() {
  local fd="$1" kind="$2"
  shift 2

  local color=""
  if _setup_supports_color "$fd"; then
    case "$kind" in
      heading|prompt) color="$(_setup_color blue)" ;;
      success) color="$(_setup_color green)" ;;
      warn) color="$(_setup_color yellow)" ;;
      error) color="$(_setup_color red)" ;;
      *) color="$(_setup_color cyan)" ;;
    esac
  fi

  local reset=""
  if [[ -n "$color" ]]; then
    reset="$(_setup_color reset)"
  fi

  if [[ "$fd" == "2" ]]; then
    printf '%b[foolery]%b %s %s\n' "$color" "$reset" "$(_setup_icon "$kind" "$fd")" "$*" >&2
  else
    printf '%b[foolery]%b %s %s\n' "$color" "$reset" "$(_setup_icon "$kind" "$fd")" "$*"
  fi
}

_setup_log() {
  _setup_emit 1 info "$*"
}

_setup_success() {
  _setup_emit 1 success "$*"
}

_setup_heading() {
  local color="" reset=""
  if _setup_supports_color 2; then
    color="$(_setup_color blue)"
    reset="$(_setup_color reset)"
  fi
  printf '\n%b[foolery]%b %s %s\n' "$color" "$reset" "$(_setup_icon heading 2)" "$1" >"$_SETUP_OUTPUT"
}

_setup_prompt() {
  local color="" reset=""
  if _setup_supports_color 2; then
    color="$(_setup_color blue)"
    reset="$(_setup_color reset)"
  fi
  printf '%b[foolery]%b %s %s' "$color" "$reset" "$(_setup_icon prompt 2)" "$1" >"$_SETUP_OUTPUT"
}

_setup_confirm() {
  local prompt="$1" default="${2:-y}"
  local answer
  _setup_prompt "$prompt"
  read -r answer || answer=""
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
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
      printf '%s\n' \
        claude-opus-4.7 \
        claude-sonnet-4.6 \
        claude-opus-4.6 \
        claude-sonnet-4.5 \
        claude-haiku-4.5 \
        claude-opus-4.5
      ;;
    gemini)
      printf '%s\n' gemini-2.5-pro gemini-2.5-flash
      ;;
    opencode)
      opencode models 2>/dev/null
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Repo discovery wizard
# ---------------------------------------------------------------------------

REGISTRY_DIR="${HOME}/.config/foolery"
REGISTRY_FILE="${REGISTRY_DIR}/registry.json"
KNOWN_MEMORY_MANAGERS=(knots beads)

_memory_manager_marker_dir() {
  case "$1" in
    knots) printf '.knots' ;;
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
  _setup_heading 'The following clones are already mounted:'
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
  local found_repos="$1" i=0 count noun
  count="$(printf '%s\n' "$found_repos" | sed '/^$/d' | wc -l | tr -d ' ')"
  noun='repositories'
  if [[ "$count" == "1" ]]; then
    noun='repository'
  fi
  printf '\n' >&2
  _setup_emit 2 repo "Found $count unmounted $noun:"
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    local memory_manager_type repo_dir
    memory_manager_type="${record%%|*}"
    repo_dir="${record#*|}"
    i=$((i + 1))
    printf '  %d) %s [%s]\n' "$i" "$repo_dir" "$memory_manager_type" >&2
  done <<EOF
$found_repos
EOF
}

_mount_selected_repos() {
  local found_repos="$1" choice
  _setup_prompt "Enter numbers to mount (comma-separated, or 'all') [all]: "
  read -r choice || choice=""
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

  local unmounted_repos="" record repo_dir
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

  if [[ -z "$unmounted_repos" ]]; then
    _setup_log "All found repositories are already mounted."
    return 0
  fi

  _display_scan_results "$unmounted_repos"
  _mount_selected_repos "$unmounted_repos"
}

_handle_manual_entry() {
  while true; do
    local repo_path
    _setup_prompt 'Enter repository path (or empty to finish): '
    read -r repo_path || break
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
  _setup_heading 'How would you like to find repositories?'
  printf '  1) Scan a directory for supported memory managers (default: ~, up to 2 levels deep)\n'
  printf '  2) Manually specify paths\n'
  local method
  _setup_prompt 'Choice [1]: '
  read -r method || method=""
  method="${method:-1}"

  case "$method" in
    1)
      local scan_dir
      _setup_prompt "Directory to scan [$HOME]: "
      read -r scan_dir || scan_dir=""
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
      _setup_emit 2 warn "Invalid choice: $method"
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
KNOWN_AGENTS=(claude copilot codex gemini opencode)
REGISTERED_AGENTS=()
FOUND_AGENTS=()

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
  mkdir -p "$_AGENT_CONFIG_DIR"

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
    if [[ ${#REGISTERED_AGENTS[@]} -gt 0 ]]; then
      registered_agents=("${REGISTERED_AGENTS[@]}")
    elif [[ ${#FOUND_AGENTS[@]} -gt 0 ]]; then
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
      # Empty pools must be written under [pools] before
      # any [[pools.X]] array-of-tables sections.
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
      # Non-empty pools as array-of-tables.
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
  } > "$_AGENT_SETTINGS_FILE"
}

_detect_agents() {
  FOUND_AGENTS=()
  local aid
  for aid in "${KNOWN_AGENTS[@]}"; do
    if command -v "$aid" >/dev/null 2>&1; then
      local agent_path
      agent_path="$(command -v "$aid")"
      _setup_log "Found: $aid (at $agent_path)"
      FOUND_AGENTS+=("$aid")
    fi
  done
}

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

  _setup_heading "Which agent for \"$action_label\"?"
  for ((i = 0; i < count; i++)); do
    local marker=""
    if [[ $((i + 1)) -eq "$default_idx" ]]; then
      marker=" (current)"
    fi
    printf '  %d) %s%s\n' "$((i + 1))" \
      "${agents[$i]}" "$marker" >"$_SETUP_OUTPUT"
  done

  local choice
  _setup_prompt "Choice [$default_idx]: "
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
    _setup_prompt "$prompt"
  else
    _setup_prompt "Model for $aid (optional, press Enter to skip): "
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

  if ((_HAS_MODEL_PICKER && ${#models[@]} > _MODEL_SEARCH_THRESHOLD))
  then
    _model_search_pick _setup_heading _setup_prompt \
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
    _setup_heading "Available models for $aid"
    local i
    for ((i = 0; i < count; i++)); do
      printf '  %d) %s\n' "$((i + 1))" "${remaining[$i]}" >"$_SETUP_OUTPUT"
    done
    printf '  %d) Done\n' "$((count + 1))" >"$_SETUP_OUTPUT"
    printf '  %d) Other (type manually)\n' "$((count + 2))" >"$_SETUP_OUTPUT"

    local choice
    _setup_prompt "Choice [$((count + 1))]: "
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

_prompt_action_mappings() {
  local -a action_names=(take scene breakdown scopeRefinement)
  local -a action_labels=(
    '"Take!" (execute single beat)'
    '"Scene!" (multi-beat orchestration)'
    '"Breakdown" (decomposition)'
    '"Scope Refinement" (refine new beats)'
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

_show_existing_agents() {
  if [[ ${#REGISTERED_AGENTS[@]} -eq 0 ]]; then
    return
  fi
  _setup_heading "Current registered agents:"
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
}

_agent_wizard() {
  _show_existing_agents

  printf '\n'
  if ! _setup_confirm \
    "Scan for and auto-register AI agents? [Y/n] " "y"; then
    return 0
  fi

  _detect_agents

  if [[ ${#FOUND_AGENTS[@]} -eq 0 ]]; then
    _setup_log \
      "No supported agents found on PATH. Add them later in Settings."
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
    for action in take scene breakdown scopeRefinement; do
      local existing
      existing="$(_kv_get ACTION_MAP "$action" "")"
      if [[ -z "$existing" ]]; then
        _kv_set ACTION_MAP "$action" "$sole"
      fi
    done
    _setup_success "Registered $sole for all actions."
  else
    _register_scanned_agents
  fi
}

# ---------------------------------------------------------------------------
# Dispatch wizard — basic (per-action) or advanced (weighted pools)
# ---------------------------------------------------------------------------

_ALL_POOL_STEPS=(
  planning plan_review implementation
  implementation_review shipment shipment_review
  scope_refinement
)
_ALL_POOL_LABELS=(
  "Planning" "Plan Review" "Implementation"
  "Impl Review" "Shipment" "Ship Review"
  "Scope Refinement"
)

_prompt_single_pool() {
  local step="$1" label="$2"
  if [[ ${#REGISTERED_AGENTS[@]} -eq 0 ]]; then
    return 0
  fi

  local existing_count
  existing_count="$(_kv_get POOL_COUNT "$step" "0")"

  _setup_heading "Pool: $label"

  # Show existing pool and offer to keep it.
  if [[ "$existing_count" -gt 0 ]]; then
    printf '  Current pool (%d agent(s)):\n' \
      "$existing_count" >"$_SETUP_OUTPUT"
    local j
    for ((j = 0; j < existing_count; j++)); do
      local eid ew
      eid="$(_kv_get "POOL_AGENT_${step}" "$j" "")"
      ew="$(_kv_get "POOL_WEIGHT_${step}" "$eid" "1")"
      printf '    - %s (weight %d)\n' \
        "$eid" "$ew" >"$_SETUP_OUTPUT"
    done
    printf '  1) Keep current\n' >"$_SETUP_OUTPUT"
    printf '  2) Reconfigure\n' >"$_SETUP_OUTPUT"
    local keep_choice
    _setup_prompt "Choice [1]: "
    read -r keep_choice || keep_choice=""
    keep_choice="${keep_choice:-1}"
    if [[ "$keep_choice" != "2" ]]; then
      return 0
    fi
  fi

  local count=${#REGISTERED_AGENTS[@]}
  local i
  for ((i = 0; i < count; i++)); do
    printf '  %d) %s\n' "$((i + 1))" \
      "${REGISTERED_AGENTS[$i]}" >"$_SETUP_OUTPUT"
  done
  printf '  0) Skip (empty pool)\n' >"$_SETUP_OUTPUT"

  local pool_count=0
  while true; do
    local choice
    _setup_prompt "Add agent to pool (0 when done) [0]: "
    read -r choice || choice=""
    choice="${choice:-0}"

    if [[ "$choice" == "0" ]]; then
      break
    fi

    if [[ "$choice" =~ ^[0-9]+$ ]] \
      && ((choice >= 1 && choice <= count)); then
      local agent_id="${REGISTERED_AGENTS[$((choice - 1))]}"
      local weight
      _setup_prompt "Weight for $agent_id [1]: "
      read -r weight || weight=""
      weight="${weight:-1}"
      if ! [[ "$weight" =~ ^[0-9]+$ ]] || ((weight < 1)); then
        weight=1
      fi

      _kv_set "POOL_AGENT_${step}" "$pool_count" "$agent_id"
      _kv_set "POOL_WEIGHT_${step}" "$agent_id" "$weight"
      pool_count=$((pool_count + 1))
    fi
  done
  _kv_set POOL_COUNT "$step" "$pool_count"
}

_prompt_pool_config() {
  if [[ ${#REGISTERED_AGENTS[@]} -eq 0 ]]; then
    _setup_log \
      "No agents registered. Complete Agents & Models first."
    return 0
  fi

  local i
  for ((i = 0; i < ${#_ALL_POOL_STEPS[@]}; i++)); do
    _prompt_single_pool \
      "${_ALL_POOL_STEPS[$i]}" "${_ALL_POOL_LABELS[$i]}"
  done
}

_show_existing_dispatch() {
  local dm
  dm="$(_kv_get DISPATCH dispatch_mode "")"
  if [[ -z "$dm" ]]; then
    return
  fi
  _setup_heading "Current dispatch configuration:"
  printf '  Mode: %s\n' "$dm" >"$_SETUP_OUTPUT"
  if [[ "$dm" == "basic" ]]; then
    local action val
    for action in take scene breakdown scopeRefinement; do
      val="$(_kv_get ACTION_MAP "$action" "")"
      if [[ -n "$val" ]]; then
        printf '  %s -> %s\n' "$action" "$val" >"$_SETUP_OUTPUT"
      fi
    done
  else
    local i step label count
    for ((i = 0; i < ${#_ALL_POOL_STEPS[@]}; i++)); do
      step="${_ALL_POOL_STEPS[$i]}"
      label="${_ALL_POOL_LABELS[$i]}"
      count="$(_kv_get POOL_COUNT "$step" "0")"
      if [[ "$count" -gt 0 ]]; then
        printf '  %s: %s agent(s)\n' \
          "$label" "$count" >"$_SETUP_OUTPUT"
      fi
    done
  fi
}

_dispatch_wizard() {
  _setup_heading 'Dispatch Configuration'

  if [[ ${#REGISTERED_AGENTS[@]} -eq 0 ]]; then
    _setup_log \
      "No agents registered. Complete Agents & Models first."
    return 0
  fi

  _show_existing_dispatch

  printf '  1) Simple  — one agent per action\n' >"$_SETUP_OUTPUT"
  printf '  2) Advanced — weighted pools per workflow step\n' >"$_SETUP_OUTPUT"

  local current_dm
  current_dm="$(_kv_get DISPATCH dispatch_mode "basic")"
  local dm_default=1
  if [[ "$current_dm" == "advanced" ]]; then
    dm_default=2
  fi

  local mode_choice
  _setup_prompt "Choice [$dm_default]: "
  read -r mode_choice || mode_choice=""
  mode_choice="${mode_choice:-$dm_default}"

  case "$mode_choice" in
    2)
      _kv_set DISPATCH dispatch_mode "advanced"
      _prompt_pool_config
      ;;
    *)
      _kv_set DISPATCH dispatch_mode "basic"
      _prompt_action_mappings
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Defaults wizard — sessions, claims, scope refinement prompt
# ---------------------------------------------------------------------------

_validate_int_range() {
  local value="$1" min="$2" max="$3" default="$4"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s' "$default"
    return
  fi
  if ((value < min)); then
    printf '%s' "$min"
  elif ((value > max)); then
    printf '%s' "$max"
  else
    printf '%s' "$value"
  fi
}

_prompt_scope_refinement_prompt() {
  _setup_heading 'Scope Refinement Prompt'
  printf '\n  Current prompt:\n' >"$_SETUP_OUTPUT"
  local line
  while IFS= read -r line; do
    printf '  | %s\n' "$line" >"$_SETUP_OUTPUT"
  done <<< "${_SCOPE_PROMPT:-$_DEFAULT_SCOPE_REFINEMENT_PROMPT}"
  printf '\n' >"$_SETUP_OUTPUT"

  printf '  1) Keep current (recommended)\n' >"$_SETUP_OUTPUT"
  printf '  2) Edit with %s\n' "${EDITOR:-vi}" >"$_SETUP_OUTPUT"
  printf '  3) Type a replacement\n' >"$_SETUP_OUTPUT"

  local choice
  _setup_prompt 'Choice [1]: '
  read -r choice || choice=""
  choice="${choice:-1}"

  case "$choice" in
    2)
      local tmpfile
      tmpfile="$(mktemp "${TMPDIR:-/tmp}/foolery-scope.XXXXXX")"
      printf '%s\n' \
        "${_SCOPE_PROMPT:-$_DEFAULT_SCOPE_REFINEMENT_PROMPT}" \
        > "$tmpfile"
      "${EDITOR:-vi}" "$tmpfile" >"$_SETUP_OUTPUT"
      _SCOPE_PROMPT="$(cat "$tmpfile")"
      rm -f "$tmpfile"
      _setup_success "Prompt updated."
      ;;
    3)
      _setup_log \
        "Supports {{title}}, {{description}}, {{acceptance}}."
      _setup_log "Enter an empty line to finish."
      local line new_prompt=""
      while IFS= read -r line; do
        [[ -z "$line" ]] && break
        if [[ -z "$new_prompt" ]]; then
          new_prompt="$line"
        else
          new_prompt="$(printf '%s\n%s' "$new_prompt" "$line")"
        fi
      done
      if [[ -n "$new_prompt" ]]; then
        _SCOPE_PROMPT="${new_prompt}
"
        _setup_success "Prompt updated."
      else
        _setup_log "No input; keeping current prompt."
      fi
      ;;
    *)
      _setup_log "Keeping current prompt."
      ;;
  esac
}

_defaults_wizard() {
  _setup_heading 'Defaults & Scope Refinement'

  local cur_mcs cur_mcq
  cur_mcs="$(_kv_get DEFAULTS max_concurrent_sessions "5")"
  cur_mcq="$(_kv_get DEFAULTS max_claims_per_queue_type "10")"

  local mcs
  _setup_prompt "Max concurrent sessions (1-20) [$cur_mcs]: "
  read -r mcs || mcs=""
  mcs="$(_validate_int_range "${mcs:-$cur_mcs}" 1 20 "$cur_mcs")"
  _kv_set DEFAULTS max_concurrent_sessions "$mcs"

  local mcq
  _setup_prompt "Max claims per queue type (1-50) [$cur_mcq]: "
  read -r mcq || mcq=""
  mcq="$(_validate_int_range \
    "${mcq:-$cur_mcq}" 1 50 "$cur_mcq")"
  _kv_set DEFAULTS max_claims_per_queue_type "$mcq"

  _prompt_scope_refinement_prompt
}

# ---------------------------------------------------------------------------
# Main entry point — step-based navigation
# ---------------------------------------------------------------------------

_STEPS=(
  "Repositories"
  "Agents & Models"
  "Dispatch"
  "Defaults & Prompt"
  "Save & Exit"
)

_show_main_menu() {
  printf '\n' >"$_SETUP_OUTPUT"
  _setup_heading 'Foolery Setup'
  local i
  for ((i = 0; i < ${#_STEPS[@]}; i++)); do
    local status
    status="$(_kv_get STEP_STATUS "${_STEPS[$i]}" "")"
    if [[ -n "$status" ]]; then
      printf '  %d) %s [%s]\n' \
        "$((i + 1))" "${_STEPS[$i]}" "$status" >"$_SETUP_OUTPUT"
    else
      printf '  %d) %s\n' "$((i + 1))" "${_STEPS[$i]}" >"$_SETUP_OUTPUT"
    fi
  done
  printf '  q) Quit without saving\n' >"$_SETUP_OUTPUT"
}

foolery_setup() {
  if [[ ! -t 0 ]]; then
    _setup_emit 2 error 'setup requires an interactive terminal.'
    return 1
  fi

  # Load existing configuration so all wizards are additive
  _read_settings_toml "$_AGENT_SETTINGS_FILE"

  while true; do
    _show_main_menu
    local choice
    _setup_prompt 'Step [1-5, or q]: '
    read -r choice || break
    case "$choice" in
      1)
        _repo_wizard
        _kv_set STEP_STATUS "${_STEPS[0]}" "done"
        ;;
      2)
        _agent_wizard
        _kv_set STEP_STATUS "${_STEPS[1]}" "done"
        ;;
      3)
        _dispatch_wizard
        _kv_set STEP_STATUS "${_STEPS[2]}" "done"
        ;;
      4)
        _defaults_wizard
        _kv_set STEP_STATUS "${_STEPS[3]}" "done"
        ;;
      5)
        _write_settings_toml
        _setup_success \
          "Settings saved to $_AGENT_SETTINGS_FILE"
        break
        ;;
      q|Q)
        _setup_log 'Exiting without saving.'
        return 0
        ;;
      *)
        _setup_emit 2 warn "Invalid choice: $choice"
        ;;
    esac
  done
}

# Allow direct execution: bash setup.sh
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  foolery_setup "$@"
fi
