#!/usr/bin/env bash
# Bash TOML reader for foolery settings.toml.
# Loads existing configuration into KV store so wizards can be additive.
#
# Compatible with Bash 3.2+ (macOS default).
# Handles both shell-writer and smol-toml output formats.
#
# Requires _kv_set / _kv_get helpers to be defined by the sourcing script.

# Read an existing settings.toml into the KV store and REGISTERED_AGENTS.
# Sets _TOML_LOADED=1 on success, 0 on missing/empty file.
_TOML_LOADED=0

_read_settings_toml() {
  local settings_file="$1"
  _TOML_LOADED=0

  # Ensure REGISTERED_AGENTS exists (safe under set -u).
  # Note: bash treats empty arrays as unset for ${var+set},
  # so we use declare -p to check existence.
  if ! declare -p REGISTERED_AGENTS &>/dev/null; then
    REGISTERED_AGENTS=()
  fi

  if [[ ! -f "$settings_file" ]]; then
    return 0
  fi

  local content
  content="$(cat "$settings_file" 2>/dev/null)" || return 0
  if [[ -z "$content" ]]; then
    return 0
  fi

  # State tracking
  local current_section=""
  local current_agent_id=""
  local in_multiline=""
  local multiline_key=""
  local multiline_value=""
  local pool_step=""
  local pool_agent_id=""

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Handle multi-line strings (triple-quoted)
    if [[ -n "$in_multiline" ]]; then
      if [[ "$line" == *'"""' ]]; then
        # End of multi-line — strip trailing """
        local tail="${line%%\"\"\"*}"
        multiline_value="${multiline_value}${tail}"
        if [[ "$in_multiline" == "scope_prompt" ]]; then
          _SCOPE_PROMPT="$multiline_value"
        fi
        in_multiline=""
        multiline_key=""
        multiline_value=""
      else
        multiline_value="${multiline_value}${line}
"
      fi
      continue
    fi

    # Strip inline comments (not inside quotes — simple heuristic)
    local stripped="$line"
    stripped="${stripped%%#*}"

    # Skip blank lines
    if [[ -z "${stripped// /}" ]]; then
      continue
    fi

    # Array-of-tables header: [[pools.step_name]]
    if [[ "$stripped" =~ ^\[\[pools\.([a-z_]+)\]\] ]]; then
      pool_step="${BASH_REMATCH[1]}"
      pool_agent_id=""
      current_section="pool_entry"
      current_agent_id=""
      continue
    fi

    # Table header: [section] or [agents.id]
    if [[ "$stripped" =~ ^\[([^]]+)\] ]]; then
      local header="${BASH_REMATCH[1]}"
      pool_step=""
      pool_agent_id=""

      if [[ "$header" == agents.* ]]; then
        current_section="agent"
        # Extract agent ID — may be quoted: [agents."my-id"]
        current_agent_id="${header#agents.}"
        # Strip surrounding quotes if present
        current_agent_id="${current_agent_id#\"}"
        current_agent_id="${current_agent_id%\"}"

        # Add to REGISTERED_AGENTS if not already present
        local already=0 existing
        for existing in ${REGISTERED_AGENTS[@]+"${REGISTERED_AGENTS[@]}"}; do
          if [[ "$existing" == "$current_agent_id" ]]; then
            already=1
            break
          fi
        done
        if [[ "$already" -eq 0 ]]; then
          REGISTERED_AGENTS+=("$current_agent_id")
        fi
      elif [[ "$header" == "actions" ]]; then
        current_section="actions"
        current_agent_id=""
      elif [[ "$header" == "backend" ]]; then
        current_section="backend"
        current_agent_id=""
      elif [[ "$header" == "defaults" ]]; then
        current_section="defaults"
        current_agent_id=""
      elif [[ "$header" == "scopeRefinement" ]]; then
        current_section="scope"
        current_agent_id=""
      elif [[ "$header" == "pools" ]]; then
        current_section="pools"
        current_agent_id=""
      else
        current_section="$header"
        current_agent_id=""
      fi
      continue
    fi

    # Key = value parsing
    local _kv_re='^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*=[[:space:]]*(.*)'
    local _qkv_re='^[[:space:]]*"([^"]+)"[[:space:]]*=[[:space:]]*(.*)'
    if [[ "$stripped" =~ $_kv_re ]]; then
      :
    elif [[ "$stripped" =~ $_qkv_re ]]; then
      :
    else
      continue
    fi

    local key="${BASH_REMATCH[1]}"
    local raw_value="${BASH_REMATCH[2]}"

    # Trim trailing whitespace
    raw_value="${raw_value%"${raw_value##*[![:space:]]}"}"

    # Parse the value
    local value=""
    if [[ "$raw_value" == '"""'* ]]; then
      # Multi-line string start
      local after="${raw_value#\"\"\"}"
      if [[ "$after" == *'"""' ]]; then
        # Single-line triple-quoted
        value="${after%\"\"\"}"
      else
        # True multi-line — per TOML spec, a newline
        # immediately after """ is trimmed.
        if [[ -n "$after" ]]; then
          multiline_value="${after}
"
        else
          multiline_value=""
        fi
        multiline_key="$key"
        if [[ "$current_section" == "scope" && "$key" == "prompt" ]]; then
          in_multiline="scope_prompt"
        else
          in_multiline="generic"
        fi
        continue
      fi
    elif [[ "$raw_value" == '"'*'"' ]]; then
      # Regular quoted string
      value="${raw_value#\"}"
      value="${value%\"}"
    elif [[ "$raw_value" == "true" ]]; then
      value="true"
    elif [[ "$raw_value" == "false" ]]; then
      value="false"
    elif [[ "$raw_value" =~ ^[0-9]+$ ]]; then
      value="$raw_value"
    elif [[ "$raw_value" == "[]" ]]; then
      value="[]"
    else
      # Unquoted or other — take as-is
      value="$raw_value"
    fi

    # Store based on current section
    case "$current_section" in
      "")
        # Top-level scalars
        case "$key" in
          dispatchMode)
            _kv_set DISPATCH dispatch_mode "$value"
            ;;
          maxConcurrentSessions)
            _kv_set DEFAULTS max_concurrent_sessions "$value"
            ;;
          maxClaimsPerQueueType)
            _kv_set DEFAULTS max_claims_per_queue_type "$value"
            ;;
          terminalLightTheme)
            _kv_set DEFAULTS terminal_light_theme "$value"
            ;;
        esac
        ;;
      agent)
        if [[ -n "$current_agent_id" ]]; then
          case "$key" in
            command)
              _kv_set AGENT_COMMANDS "$current_agent_id" "$value"
              ;;
            label)
              _kv_set AGENT_LABELS "$current_agent_id" "$value"
              ;;
            model)
              _kv_set AGENT_MODELS "$current_agent_id" "$value"
              ;;
            agent_type)
              _kv_set AGENT_TYPES "$current_agent_id" "$value"
              ;;
            vendor)
              _kv_set AGENT_VENDORS "$current_agent_id" "$value"
              ;;
            provider)
              _kv_set AGENT_PROVIDERS "$current_agent_id" "$value"
              ;;
            agent_name)
              _kv_set AGENT_NAMES "$current_agent_id" "$value"
              ;;
            lease_model)
              _kv_set AGENT_LEASE_MODELS \
                "$current_agent_id" "$value"
              ;;
            flavor)
              _kv_set AGENT_FLAVORS "$current_agent_id" "$value"
              ;;
            version)
              _kv_set AGENT_VERSIONS "$current_agent_id" "$value"
              ;;
          esac
        fi
        ;;
      actions)
        _kv_set ACTION_MAP "$key" "$value"
        ;;
      backend)
        if [[ "$key" == "type" ]]; then
          _kv_set BACKEND type "$value"
        fi
        ;;
      defaults)
        case "$key" in
          profileId)
            _kv_set DEFAULTS_SECTION profileId "$value"
            ;;
        esac
        ;;
      scope)
        if [[ "$key" == "prompt" ]]; then
          _SCOPE_PROMPT="$value"
        fi
        ;;
      pools)
        # Inline empty arrays: step = []
        # We just note the step exists (no entries)
        ;;
      pool_entry)
        # Inside [[pools.step_name]]
        if [[ -n "$pool_step" ]]; then
          case "$key" in
            agentId)
              pool_agent_id="$value"
              local count
              count="$(_kv_get POOL_COUNT "$pool_step" "0")"
              _kv_set "POOL_AGENT_${pool_step}" "$count" "$value"
              ;;
            weight)
              if [[ -n "$pool_agent_id" ]]; then
                _kv_set "POOL_WEIGHT_${pool_step}" \
                  "$pool_agent_id" "$value"
                local count
                count="$(_kv_get POOL_COUNT "$pool_step" "0")"
                count=$((count + 1))
                _kv_set POOL_COUNT "$pool_step" "$count"
                pool_agent_id=""
              fi
              ;;
          esac
        fi
        ;;
    esac
  done <<< "$content"

  _TOML_LOADED=1
}
