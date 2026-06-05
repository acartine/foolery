#!/usr/bin/env bash
# Agent discovery smoke test for the Foolery HTTP API.
#
# Exercises the documented "find spec -> resolve repo -> call endpoint" flow
# against a LIVE Foolery server, proving an agent can bootstrap the API with no
# source-code knowledge. Intentionally NOT part of the hermetic test suite: it
# hits a real server over HTTP.
#
# Usage:
#   bash scripts/agent-discovery-smoke.sh
#
# Environment overrides:
#   FOOLERY_BASE_URL   Base URL of a running server (default http://localhost:3000)
#   FOOLERY_REPO_NAME  Repository name to resolve from the registry (optional;
#                      when unset, the first registered repo is used)
set -euo pipefail

BASE="${FOOLERY_BASE_URL:-http://localhost:3000}"
REPO_NAME="${FOOLERY_REPO_NAME:-}"

have_jq() { command -v jq >/dev/null 2>&1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

if ! have_jq; then
  fail "jq is required for this smoke test"
fi

echo "==> 1. Machine-discovery entrypoint (/.well-known/foolery.json)"
DISCOVERY="$(curl -fsS "$BASE/.well-known/foolery.json")" \
  || fail "could not fetch /.well-known/foolery.json"
SPEC_PATH="$(echo "$DISCOVERY" | jq -r '.openapi')"
REGISTRY_PATH="$(echo "$DISCOVERY" | jq -r '.endpoints.registry')"
[ "$SPEC_PATH" = "/api/openapi.json" ] || fail "unexpected openapi path: $SPEC_PATH"
echo "    discovery ok: openapi=$SPEC_PATH registry=$REGISTRY_PATH"

echo "==> 2. Alias entrypoint (/api/discovery) matches"
ALIAS="$(curl -fsS "$BASE/api/discovery")" || fail "could not fetch /api/discovery"
[ "$(echo "$ALIAS" | jq -r '.openapi')" = "$SPEC_PATH" ] \
  || fail "/api/discovery disagrees with /.well-known/foolery.json"
echo "    alias ok"

echo "==> 3. OpenAPI spec is reachable and self-describing"
TITLE="$(curl -fsS "$BASE$SPEC_PATH" | jq -r '.info.title')" \
  || fail "could not fetch $SPEC_PATH"
echo "    spec title: $TITLE"

echo "==> 4. Resolve a repository from the registry"
REGISTRY="$(curl -fsS "$BASE$REGISTRY_PATH")" || fail "could not fetch $REGISTRY_PATH"
if [ -n "$REPO_NAME" ]; then
  REPO_PATH="$(echo "$REGISTRY" \
    | jq -r --arg n "$REPO_NAME" '.data[] | select(.name==$n) | .path' | head -n1)"
else
  REPO_PATH="$(echo "$REGISTRY" | jq -r '.data[0].path // empty')"
fi
[ -n "$REPO_PATH" ] || fail "no repository resolved (register one or set FOOLERY_REPO_NAME)"
echo "    resolved repo path: $REPO_PATH"

echo "==> 5. Call a documented repo-scoped endpoint with the resolved path"
COUNT="$(curl -fsS "$BASE/api/beats?_repo=$REPO_PATH" | jq '.data | length')" \
  || fail "could not list beats for $REPO_PATH"
echo "    /api/beats returned $COUNT beat(s)"

echo "PASS: agent discovery flow succeeded end-to-end"
