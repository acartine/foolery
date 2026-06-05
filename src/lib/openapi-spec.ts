/**
 * Foolery OpenAPI 3.1.0 specification.
 *
 * Assembled from modular path and schema definitions in src/lib/openapi/.
 */

import { componentSchemas } from "@/lib/openapi/schemas";
import {
  API_VERSION,
  agentGuideMarkdown,
  DISCOVERY_WELL_KNOWN_PATH,
} from "@/lib/openapi/agent-guide";
import { beatsPaths } from "@/lib/openapi/paths-beats";
import { depsPaths } from "@/lib/openapi/paths-deps";
import { plansPaths } from "@/lib/openapi/paths-plans";
import { plansCompletePaths } from "@/lib/openapi/paths-plans-complete";
import { wavesPaths } from "@/lib/openapi/paths-waves";
import {
  terminalPaths,
  orchestrationPaths,
} from "@/lib/openapi/paths-streaming";
import { settingsPaths } from "@/lib/openapi/paths-settings";
import {
  registryPaths,
  systemPaths,
  discoveryPaths,
} from "@/lib/openapi/paths-system";
import { approvalsPaths } from "@/lib/openapi/paths-approvals";
import {
  staleGroomingPaths,
} from "@/lib/openapi/paths-stale-grooming";
import { syncPaths } from "@/lib/openapi/paths-sync";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Foolery API",
    version: API_VERSION,
    description:
      "Work-item orchestration API for Foolery. Manages beats (work items), " +
      "wave planning, agent terminals, orchestration, " +
      "settings, and repository registry.\n\n" +
      agentGuideMarkdown,
  },
  externalDocs: {
    description: "Agent onboarding docs (rendered guide + interactive spec)",
    url: "/api/docs",
  },
  "x-agent-discovery": DISCOVERY_WELL_KNOWN_PATH,
  servers: [
    { url: "/", description: "Same-origin relative base (browser / in-app)" },
    { url: "http://localhost:3000", description: "Local dev server" },
    { url: "http://localhost:3210", description: "Installed runtime" },
  ],
  tags: [
    { name: "Beats", description: "Beat (work item) CRUD and actions" },
    { name: "Dependencies", description: "Beat dependency management" },
    { name: "Plans", description: "Persisted execution plans and step driving" },
    { name: "Waves", description: "Wave-based execution planning" },
    { name: "Terminal", description: "Agent terminal sessions and SSE streams" },
    { name: "Approvals", description: "Approval escalations queue, listing, and per-record actions" },
    { name: "Orchestration", description: "Multi-wave orchestration sessions" },
    { name: "Settings", description: "Application and agent configuration" },
    { name: "Registry", description: "Repository registration and browsing" },
    { name: "Scope refinement", description: "AI scope-refinement jobs, worker health, and queue status" },
    { name: "Stale grooming", description: "AI stale beat reviews, queue status, and model options" },
    { name: "Sync", description: "Global Knots/Beads synchronization jobs" },
    { name: "System", description: "Diagnostics, version, capabilities, workflows, and history" },
  ],
  paths: {
    ...beatsPaths,
    ...depsPaths,
    ...plansPaths,
    ...plansCompletePaths,
    ...wavesPaths,
    ...terminalPaths,
    ...approvalsPaths,
    ...orchestrationPaths,
    ...staleGroomingPaths,
    ...syncPaths,
    ...settingsPaths,
    ...registryPaths,
    ...systemPaths,
    ...discoveryPaths,
  },
  components: {
    schemas: componentSchemas,
    parameters: {
      RepoParam: {
        name: "_repo",
        in: "query",
        required: false,
        schema: { type: "string" },
        description:
          "Absolute path of the target repository (multi-repo support). "
          + "Resolve it from GET /api/registry by matching the repo `name`, "
          + "then pass the returned `path` here.",
      },
    },
  },
} as const;
