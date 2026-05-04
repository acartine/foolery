/**
 * Foolery OpenAPI 3.1.0 specification.
 *
 * Assembled from modular path and schema definitions in src/lib/openapi/.
 */

import { componentSchemas } from "@/lib/openapi/schemas";
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
import { registryPaths, systemPaths } from "@/lib/openapi/paths-system";
import { approvalsPaths } from "@/lib/openapi/paths-approvals";
import {
  staleGroomingPaths,
} from "@/lib/openapi/paths-stale-grooming";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Foolery API",
    version: "1.0.0",
    description:
      "Work-item orchestration API for Foolery. Manages beats (work items), " +
      "wave planning, agent terminals, orchestration, " +
      "settings, and repository registry.",
  },
  servers: [{ url: "/" }],
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
    ...settingsPaths,
    ...registryPaths,
    ...systemPaths,
  },
  components: {
    schemas: componentSchemas,
  },
} as const;
