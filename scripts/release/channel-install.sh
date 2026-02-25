#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHANNEL_ROOT="${FOOLERY_CHANNEL_ROOT:-${HOME}/.local/share/foolery/channels}"
ACTIVE_LINK="${FOOLERY_ACTIVE_LINK:-${HOME}/.local/bin/foolery}"
DEFAULT_RELEASE_INSTALLER_URL="https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh"
RELEASE_INSTALLER_URL="${FOOLERY_RELEASE_INSTALLER_URL:-${DEFAULT_RELEASE_INSTALLER_URL}}"
LOCAL_ARTIFACT_PATH="${FOOLERY_LOCAL_ARTIFACT_PATH:-}"
LOCAL_DIST_DIR="${FOOLERY_LOCAL_DIST_DIR:-}"

INSTALLER_SCRIPT="${ROOT_DIR}/scripts/install.sh"
BUILD_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/build-runtime-artifact.sh"
USE_SCRIPT="${ROOT_DIR}/scripts/release/channel-use.sh"

usage() {
  cat <<'USAGE'
Install foolery into a channel path.

Usage:
  channel-install.sh release [--activate]
  channel-install.sh local [--activate]

Default channel root:
  ~/.local/share/foolery/channels

Installed launchers:
  release -> ~/.local/share/foolery/channels/release/bin/foolery
  local   -> ~/.local/share/foolery/channels/local/bin/foolery

Optional env vars:
  FOOLERY_CHANNEL_ROOT           Override base channel directory.
  FOOLERY_ACTIVE_LINK            Override active foolery link path.
  FOOLERY_RELEASE_INSTALLER_URL  Override GitHub installer URL for release channel.

Local channel env vars:
  FOOLERY_LOCAL_ARTIFACT_PATH    Runtime tarball path. Skips local build if set.
  FOOLERY_LOCAL_DIST_DIR         Build output dir for local runtime artifact.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command '$1' not found"
  fi
}

channel_dir() {
  printf '%s/%s\n' "${CHANNEL_ROOT}" "$1"
}

install_root_for() {
  printf '%s/install-root\n' "$(channel_dir "$1")"
}

app_dir_for() {
  printf '%s/runtime\n' "$(channel_dir "$1")"
}

state_dir_for() {
  printf '%s/state\n' "$(channel_dir "$1")"
}

bin_dir_for() {
  printf '%s/bin\n' "$(channel_dir "$1")"
}

launcher_for() {
  printf '%s/foolery\n' "$(bin_dir_for "$1")"
}

activate_channel() {
  FOOLERY_CHANNEL_ROOT="${CHANNEL_ROOT}" \
  FOOLERY_ACTIVE_LINK="${ACTIVE_LINK}" \
    "${USE_SCRIPT}" "$1"
}

install_release() {
  require_cmd curl

  mkdir -p "$(channel_dir release)"
  curl -fsSL "${RELEASE_INSTALLER_URL}" | env \
    FOOLERY_INSTALL_ROOT="$(install_root_for release)" \
    FOOLERY_APP_DIR="$(app_dir_for release)" \
    FOOLERY_BIN_DIR="$(bin_dir_for release)" \
    FOOLERY_STATE_DIR="$(state_dir_for release)" \
    FOOLERY_LAUNCHER_PATH="$(launcher_for release)" \
    bash

  echo "Installed release channel at $(launcher_for release)"
}

find_runtime_artifact() {
  local dist_dir="$1"
  find "${dist_dir}" -maxdepth 1 -type f -name 'foolery-runtime-*.tar.gz' | sort | head -n 1
}

to_absolute_path() {
  local path="$1"
  if [[ "${path}" == /* ]]; then
    printf '%s\n' "${path}"
  else
    printf '%s/%s\n' "$(pwd)" "${path}"
  fi
}

install_local() {
  require_cmd bun

  local artifact_path tmp_dist_dir dist_dir
  artifact_path="${LOCAL_ARTIFACT_PATH}"

  if [[ -z "${artifact_path}" ]]; then
    if [[ -n "${LOCAL_DIST_DIR}" ]]; then
      dist_dir="${LOCAL_DIST_DIR}"
      mkdir -p "${dist_dir}"
    else
      tmp_dist_dir="$(mktemp -d "${TMPDIR:-/tmp}/foolery-channel-local.XXXXXX")"
      dist_dir="${tmp_dist_dir}"
    fi

    FOOLERY_DIST_DIR="${dist_dir}" "${BUILD_RUNTIME_SCRIPT}"
    artifact_path="$(find_runtime_artifact "${dist_dir}")"
    if [[ -z "${artifact_path}" ]]; then
      fail "failed to find local runtime artifact in ${dist_dir}"
    fi
  fi

  if [[ ! -f "${artifact_path}" ]]; then
    fail "local artifact not found: ${artifact_path}"
  fi
  artifact_path="$(to_absolute_path "${artifact_path}")"

  FOOLERY_INSTALL_ROOT="$(install_root_for local)" \
  FOOLERY_APP_DIR="$(app_dir_for local)" \
  FOOLERY_BIN_DIR="$(bin_dir_for local)" \
  FOOLERY_STATE_DIR="$(state_dir_for local)" \
  FOOLERY_LAUNCHER_PATH="$(launcher_for local)" \
  FOOLERY_ARTIFACT_URL="file://${artifact_path}" \
    "${INSTALLER_SCRIPT}"

  if [[ -n "${tmp_dist_dir:-}" ]]; then
    rm -rf "${tmp_dist_dir}"
  fi

  echo "Installed local channel at $(launcher_for local)"
}

channel="${1:-}"
if [[ -z "${channel}" || "${channel}" == "--help" || "${channel}" == "-h" ]]; then
  usage
  exit 0
fi
shift

activate=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --activate)
      activate=1
      ;;
    *)
      fail "unknown option '$1'"
      ;;
  esac
  shift
done

case "${channel}" in
  release)
    install_release
    ;;
  local)
    install_local
    ;;
  *)
    fail "unsupported channel '${channel}' (use release|local)"
    ;;
esac

if [[ "${activate}" == "1" ]]; then
  activate_channel "${channel}"
fi
