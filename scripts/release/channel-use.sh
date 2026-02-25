#!/usr/bin/env bash
set -euo pipefail

CHANNEL_ROOT="${FOOLERY_CHANNEL_ROOT:-${HOME}/.local/share/foolery/channels}"
ACTIVE_LINK="${FOOLERY_ACTIVE_LINK:-${HOME}/.local/bin/foolery}"

usage() {
  cat <<'USAGE'
Select active foolery launcher by symlink.

Usage:
  channel-use.sh release
  channel-use.sh local
  channel-use.sh show

Default paths:
  release launcher: ~/.local/share/foolery/channels/release/bin/foolery
  local launcher:   ~/.local/share/foolery/channels/local/bin/foolery
  active link:      ~/.local/bin/foolery

Optional env vars:
  FOOLERY_CHANNEL_ROOT  Override channel root directory.
  FOOLERY_ACTIVE_LINK   Override active foolery link path.
USAGE
}

resolve_target() {
  case "$1" in
    release|local)
      printf '%s/%s/bin/foolery\n' "${CHANNEL_ROOT}" "$1"
      ;;
    *)
      return 1
      ;;
  esac
}

read_channel_version() {
  local channel="$1"
  local release_version_file package_json version

  release_version_file="${CHANNEL_ROOT}/${channel}/runtime/RELEASE_VERSION"
  if [[ -f "${release_version_file}" ]]; then
    version="$(tr -d '[:space:]' <"${release_version_file}")"
    if [[ -n "${version}" ]]; then
      printf '%s\n' "${version}"
      return 0
    fi
  fi

  package_json="${CHANNEL_ROOT}/${channel}/runtime/package.json"
  if [[ -f "${package_json}" ]]; then
    version="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*$/\1/p' "${package_json}" | head -n 1)"
    if [[ -n "${version}" ]]; then
      printf '%s\n' "${version}"
      return 0
    fi
  fi

  return 1
}

show_channel() {
  local channel="$1"
  local target version

  target="$(resolve_target "${channel}")"
  if [[ ! -x "${target}" ]]; then
    echo "Channel ${channel}: not installed (${target})"
    return 0
  fi

  echo "Channel ${channel}: ${target}"
  if version="$(read_channel_version "${channel}")"; then
    echo "Channel ${channel} version: ${version}"
  fi
}

show_active() {
  local resolved

  if [[ ! -e "${ACTIVE_LINK}" ]]; then
    echo "No active foolery link found at ${ACTIVE_LINK}"
  else
    resolved="<not-a-symlink>"
    if [[ -L "${ACTIVE_LINK}" ]]; then
      resolved="$(readlink "${ACTIVE_LINK}")"
    fi
    echo "Active foolery link: ${ACTIVE_LINK}"
    echo "Resolved target: ${resolved}"
  fi

  show_channel release
  show_channel local
}

channel="${1:-}"
if [[ -z "${channel}" || "${channel}" == "--help" || "${channel}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${channel}" == "show" ]]; then
  show_active
  exit 0
fi

target="$(resolve_target "${channel}")" || {
  echo "error: unsupported channel '${channel}' (use release|local|show)" >&2
  usage
  exit 1
}

if [[ ! -x "${target}" ]]; then
  echo "error: channel launcher not found at ${target}" >&2
  echo "hint: run scripts/release/channel-install.sh ${channel}" >&2
  exit 1
fi

mkdir -p "$(dirname "${ACTIVE_LINK}")"
ln -sfn "${target}" "${ACTIVE_LINK}"

echo "Active foolery -> ${target}"
if version="$(read_channel_version "${channel}")"; then
  echo "Version: ${version}"
fi
