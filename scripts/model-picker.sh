#!/usr/bin/env bash
# Interactive model search picker for large model lists.
# Sourced by setup.sh and agent-wizard.sh.
# Compatible with Bash 3.2+ (macOS default).

_MODEL_SEARCH_THRESHOLD=20
_MODEL_SEARCH_MAX_DISPLAY=20

_model_picker_filter() {
  local query="$1"
  shift
  local lower_q
  lower_q="$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')"
  local m lower_m
  for m in "$@"; do
    if [[ -z "$query" ]]; then
      printf '%s\n' "$m"
    else
      lower_m="$(printf '%s' "$m" | tr '[:upper:]' '[:lower:]')"
      if [[ "$lower_m" == *"$lower_q"* ]]; then
        printf '%s\n' "$m"
      fi
    fi
  done
  return 0
}

_model_picker_erase_lines() {
  local n=$1
  while ((n-- > 0)); do
    printf '\033[A\033[2K' >/dev/tty 2>/dev/null || true
  done
  printf '\r' >/dev/tty 2>/dev/null || true
}

_model_picker_render() {
  local query="$1"
  local total="$2"
  local cursor="$3"
  local prev_lines="$4"
  local max_display="$5"
  shift 5
  local -a matches=("$@")
  local mcount=${#matches[@]}

  if ((prev_lines > 0)); then
    _model_picker_erase_lines "$prev_lines"
  fi

  local lines=0
  local show=$((mcount < max_display ? mcount : max_display))

  printf '\033[2K  Filter: %s\n' "$query" >/dev/tty
  lines=$((lines + 1))

  printf '\033[2K  %d of %d models match\n' \
    "$mcount" "$total" >/dev/tty
  lines=$((lines + 1))

  local i
  for ((i = 0; i < show; i++)); do
    if ((i + 1 == cursor)); then
      printf '\033[2K  \033[7m%d) %s\033[0m\n' \
        "$((i + 1))" "${matches[$i]}" >/dev/tty
    else
      printf '\033[2K  %d) %s\n' \
        "$((i + 1))" "${matches[$i]}" >/dev/tty
    fi
    lines=$((lines + 1))
  done

  if ((mcount > max_display)); then
    printf '\033[2K  ... %d more (refine search)\n' \
      "$((mcount - max_display))" >/dev/tty
    lines=$((lines + 1))
  fi

  local done_n=$((show + 1))
  local manual_n=$((show + 2))
  if ((cursor == done_n)); then
    printf '\033[2K  \033[7m%d) Done\033[0m\n' "$done_n" >/dev/tty
  else
    printf '\033[2K  %d) Done\n' "$done_n" >/dev/tty
  fi
  lines=$((lines + 1))
  if ((cursor == manual_n)); then
    printf '\033[2K  \033[7m%d) Other (type manually)\033[0m\n' \
      "$manual_n" >/dev/tty
  else
    printf '\033[2K  %d) Other (type manually)\n' "$manual_n" >/dev/tty
  fi
  lines=$((lines + 1))

  printf '\033[2K  [Type to filter | ' >/dev/tty
  printf '\xe2\x86\x91\xe2\x86\x93 Navigate | ' >/dev/tty
  printf 'Enter Select | Esc Clear]\n' >/dev/tty
  lines=$((lines + 1))

  printf '%d' "$lines"
}

# Interactive single-model picker with search.
# Outputs one of: model name, __DONE__, __MANUAL__, or empty string.
_model_search_pick_one() {
  local total="$1"
  shift
  local -a models=("$@")
  local count=${#models[@]}
  local query=""
  local cursor=1
  local prev_lines=0

  local saved_stty
  saved_stty="$(stty -g </dev/tty 2>/dev/null)" || saved_stty=""
  stty -echo -icanon min 1 </dev/tty 2>/dev/null || true

  local -a cur_matches=("${models[@]}")

  _mspo_redraw() {
    cur_matches=()
    local lower_q
    lower_q="$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')"
    local m
    for m in "${models[@]}"; do
      if [[ -z "$query" ]]; then
        cur_matches+=("$m")
      else
        local lower_m
        lower_m="$(printf '%s' "$m" | tr '[:upper:]' '[:lower:]')"
        if [[ "$lower_m" == *"$lower_q"* ]]; then
          cur_matches+=("$m")
        fi
      fi
    done

    local mcount=${#cur_matches[@]}
    local show=$((mcount < _MODEL_SEARCH_MAX_DISPLAY \
      ? mcount : _MODEL_SEARCH_MAX_DISPLAY))

    if ((cursor < 1)); then cursor=1; fi
    if ((cursor > show + 2)); then cursor=$((show + 2)); fi

    prev_lines="$(_model_picker_render \
      "$query" "$total" "$cursor" "$prev_lines" \
      "$_MODEL_SEARCH_MAX_DISPLAY" "${cur_matches[@]}")"
  }

  _mspo_redraw

  local result=""
  while true; do
    local char
    IFS= read -rsn1 char </dev/tty || break

    local ord=0
    if [[ -n "$char" ]]; then
      ord=$(printf '%d' "'$char" 2>/dev/null) || ord=0
    fi

    if [[ -z "$char" ]]; then
      local mcount=${#cur_matches[@]}
      local show=$((mcount < _MODEL_SEARCH_MAX_DISPLAY \
        ? mcount : _MODEL_SEARCH_MAX_DISPLAY))
      if ((cursor >= 1 && cursor <= show)); then
        result="${cur_matches[$((cursor - 1))]}"
      elif ((cursor == show + 1)); then
        result="__DONE__"
      elif ((cursor == show + 2)); then
        result="__MANUAL__"
      fi
      break
    elif ((ord == 127 || ord == 8)); then
      if [[ -n "$query" ]]; then
        query="${query%?}"
        cursor=1
      fi
    elif ((ord == 27)); then
      local seq1="" seq2=""
      IFS= read -rsn1 -t 0.1 seq1 </dev/tty 2>/dev/null || true
      if [[ -z "$seq1" ]]; then
        query=""
        cursor=1
      else
        IFS= read -rsn1 -t 0.1 seq2 </dev/tty 2>/dev/null || true
        if [[ "$seq1" == "[" ]]; then
          local mcount=${#cur_matches[@]}
          local show=$((mcount < _MODEL_SEARCH_MAX_DISPLAY \
            ? mcount : _MODEL_SEARCH_MAX_DISPLAY))
          local max_cursor=$((show + 2))
          case "$seq2" in
            A) if ((cursor > 1)); then
                 cursor=$((cursor - 1))
               fi ;;
            B) if ((cursor < max_cursor)); then
                 cursor=$((cursor + 1))
               fi ;;
          esac
        fi
      fi
    elif ((ord >= 32 && ord < 127)); then
      query="${query}${char}"
      cursor=1
    else
      continue
    fi

    _mspo_redraw
  done

  _model_picker_erase_lines "$prev_lines"
  if [[ -n "$saved_stty" ]]; then
    stty "$saved_stty" </dev/tty 2>/dev/null || true
  fi

  printf '%s' "$result"
}

# Full multi-select model picker with search.
# Arguments: heading_fn prompt_fn manual_fn aid models...
# Outputs selected model names (newline-separated) to stdout.
_model_search_pick() {
  local heading_fn="$1"
  local prompt_fn="$2"
  local manual_fn="$3"
  local aid="$4"
  shift 4
  local -a all_models=("$@")
  local total=${#all_models[@]}

  local -a selected=()

  while true; do
    local -a remaining=()
    local model
    for model in "${all_models[@]}"; do
      if [[ ${#selected[@]} -eq 0 ]] || \
        _append_unique "$model" "${selected[@]}"; then
        remaining+=("$model")
      fi
    done

    local rcount=${#remaining[@]}
    [[ $rcount -eq 0 ]] && break

    "$heading_fn" "Select models for $aid"
    if [[ ${#selected[@]} -gt 0 ]]; then
      printf '  Selected: %s\n' \
        "$(IFS=', '; printf '%s' "${selected[*]}")" >/dev/tty
    fi

    local pick
    pick="$(_model_search_pick_one "$total" "${remaining[@]}")"

    case "$pick" in
      __DONE__|"") break ;;
      __MANUAL__)
        local manual
        manual="$("$manual_fn" "$aid" \
          'Enter model name (optional): ')"
        if [[ -n "$manual" ]] && \
          ([[ ${#selected[@]} -eq 0 ]] || \
            _append_unique "$manual" "${selected[@]}"); then
          selected+=("$manual")
        fi
        ;;
      *)
        selected+=("$pick")
        ;;
    esac
  done

  if [[ ${#selected[@]} -gt 0 ]]; then
    printf '%s\n' "${selected[@]}"
  fi
}
