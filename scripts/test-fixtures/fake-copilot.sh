#!/usr/bin/env bash
set -euo pipefail

show_version() {
  printf 'github-copilot-cli 0.0.0-test\n'
}

stream_prompt_mode() {
  printf '%s\n' \
    '{"type":"assistant.message_delta","data":{"messageId":"msg-1","deltaContent":"Fake Copilot reply"}}'
  printf '%s\n' \
    '{"type":"assistant.message","data":{"messageId":"msg-1","content":"Fake Copilot reply","toolRequests":[{"toolCallId":"tool-1","name":"Bash","arguments":{"command":"pwd"}}]}}'
  printf '%s\n' \
    '{"type":"session.task_complete","data":{"success":true,"summary":"Fake Copilot reply"}}'
}

main() {
  if [[ $# -eq 0 ]]; then
    show_version
    return 0
  fi

  case "${1:-}" in
    --version|version)
      show_version
      ;;
    -p)
      stream_prompt_mode
      ;;
    *)
      show_version
      ;;
  esac
}

main "$@"
