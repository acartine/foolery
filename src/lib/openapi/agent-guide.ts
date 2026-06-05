/**
 * Single source of truth for Foolery's agent-facing API onboarding.
 *
 * Exports:
 * - `API_VERSION`     — the OpenAPI document version (shared with openapi-spec).
 * - `agentGuideMarkdown` — onboarding narrative rendered at the top of the
 *   ReDoc docs page (via `info.description`) so humans and agents alike see how
 *   to connect, resolve a repository, and read the response envelopes.
 * - `discoveryDocument` — a small machine-readable map served from the stable
 *   discovery routes (`/.well-known/foolery.json` and `/api/discovery`).
 *
 * Both the OpenAPI spec and the discovery routes import from here so the guide
 * never drifts between the human docs and the machine entrypoint.
 */

/** OpenAPI document version. Imported by `openapi-spec.ts` as `info.version`. */
export const API_VERSION = "1.0.0";

/** Stable, well-known machine-discovery path (RFC 8615). */
export const DISCOVERY_WELL_KNOWN_PATH = "/.well-known/foolery.json";

/** Always-available API alias for the discovery document. */
export const DISCOVERY_API_PATH = "/api/discovery";

/**
 * Onboarding guide rendered as Markdown by ReDoc at the top of `/api/docs`.
 * Keep every line <= 100 columns to satisfy the repo `max-len` rule.
 */
export const agentGuideMarkdown = [
  "## Agent quickstart",
  "",
  "This API is designed to be driven by autonomous agents **without reading",
  "Foolery source code**. Everything an agent needs — capabilities, schemas,",
  "examples, and connection guidance — is discoverable over HTTP.",
  "",
  "### 1. Discover the base URL",
  "",
  "Foolery serves a relative API, so `/` works once you know the host:",
  "",
  "- **Dev server:** `http://localhost:3000`",
  "- **Installed runtime:** `http://localhost:3210`",
  "- **Relative (same origin):** `/` — use this from browser/in-app clients.",
  "",
  "Confirm a server is live with `GET /api/version`.",
  "",
  "### 2. Machine-discovery entrypoint",
  "",
  "Fetch the discovery document for a stable map of every entrypoint:",
  "",
  "- `GET /.well-known/foolery.json` (idiomatic, RFC 8615)",
  "- `GET /api/discovery` (always-available alias)",
  "",
  "It links the OpenAPI spec, these docs, the registry, capabilities, the",
  "live workflow list, and a copy-pasteable quickstart.",
  "",
  "### 3. Resolve a repository by name",
  "",
  "Most endpoints are repo-scoped. Resolve a repo before calling them:",
  "",
  "1. `GET /api/registry` returns `{ \"data\": [{ \"path\", \"name\", ... }] }`.",
  "2. Match the human-friendly `name` (the repo basename).",
  "3. Pass the resolved `path` as the `_repo` query parameter on repo-scoped",
  "   endpoints (some legacy routes also accept `repoPath`).",
  "",
  "### 4. Response envelope conventions",
  "",
  "- **Success:** `{ \"data\": <result> }`. Some system routes wrap it as",
  "  `{ \"ok\": true, \"data\": <result> }`.",
  "- **Error:** `{ \"error\": <message>, \"banner\"?: <text>, \"marker\"?: <id> }`.",
  "  A non-2xx HTTP status always accompanies an error body; a `marker` such as",
  "  `FOOLERY DISPATCH FAILURE` pinpoints a misconfiguration.",
  "",
  "### 5. Worked example (find spec → resolve repo → call endpoint)",
  "",
  "```bash",
  "BASE=http://localhost:3000",
  "# a. discover entrypoints",
  "curl -sS \"$BASE/.well-known/foolery.json\"",
  "# b. fetch the machine-readable spec",
  "curl -sS \"$BASE/api/openapi.json\" | jq '.info.title'",
  "# c. resolve a repository named \"foolery\" to its absolute path",
  "REPO=$(curl -sS \"$BASE/api/registry\" \\",
  "  | jq -r '.data[] | select(.name==\"foolery\") | .path')",
  "# d. call a repo-scoped endpoint with the resolved path",
  "curl -sS \"$BASE/api/beats?_repo=$REPO\" | jq '.data | length'",
  "```",
  "",
  "Workflow state names are **not** hardcoded — call `GET /api/workflows` to",
  "discover the live state machine for a repository before driving beats.",
].join("\n");

/**
 * Machine-readable discovery document. Served verbatim from the discovery
 * routes. Paths are relative so the document is valid behind any base URL.
 */
export const discoveryDocument = {
  name: "Foolery API",
  description:
    "Work-item orchestration API for Foolery. Discover capabilities, "
    + "schemas, and examples over HTTP without reading source code.",
  apiVersion: API_VERSION,
  openapi: "/api/openapi.json",
  docs: "/api/docs",
  discovery: DISCOVERY_WELL_KNOWN_PATH,
  endpoints: {
    registry: "/api/registry",
    capabilities: "/api/capabilities",
    workflows: "/api/workflows",
    version: "/api/version",
    beats: "/api/beats",
  },
  baseUrls: {
    relative: "/",
    dev: "http://localhost:3000",
    installedRuntime: "http://localhost:3210",
  },
  conventions: {
    repoSelector: "_repo",
    repoResolution:
      "GET /api/registry returns { data: [{ path, name, ... }] }. Match by "
      + "`name`, then pass the resolved `path` as the `_repo` query parameter.",
    successEnvelope: "{ \"data\": <result> } or { \"ok\": true, \"data\": <result> }",
    errorEnvelope:
      "{ \"error\": <message>, \"banner\"?: <text>, \"marker\"?: <id> } with a "
      + "non-2xx HTTP status",
    workflowStates:
      "Not hardcoded. Call GET /api/workflows to discover live states per repo.",
  },
  quickstart: [
    { step: 1, description: "Confirm the server is live", call: "GET /api/version" },
    {
      step: 2,
      description: "Fetch the machine-readable API spec",
      call: "GET /api/openapi.json",
    },
    {
      step: 3,
      description: "Resolve a repository by name to its absolute path",
      call: "GET /api/registry",
    },
    {
      step: 4,
      description: "Call a repo-scoped endpoint with the resolved path",
      call: "GET /api/beats?_repo=<path>",
    },
  ],
} as const;
