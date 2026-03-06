/**
 * Foolery OpenAPI 3.1.0 specification.
 *
 * Assembled from modular path and schema definitions in src/lib/openapi/.
 */

import { componentSchemas } from "@/lib/openapi/schemas";
import { beatsPaths } from "@/lib/openapi/paths-beats";
import { depsPaths } from "@/lib/openapi/paths-deps";
import { wavesPaths } from "@/lib/openapi/paths-waves";
import {
  terminalPaths,
  breakdownPaths,
  orchestrationPaths,
} from "@/lib/openapi/paths-streaming";
import { settingsPaths } from "@/lib/openapi/paths-settings";
import { registryPaths, systemPaths } from "@/lib/openapi/paths-system";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Foolery API",
    version: "1.0.0",
    description:
      "Work-item orchestration API for Foolery. Manages beats (work items), " +
      "wave planning, agent terminals, breakdown sessions, orchestration, " +
      "settings, and repository registry.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Beats", description: "Beat (work item) CRUD and actions" },
    { name: "Dependencies", description: "Beat dependency management" },
    { name: "Waves", description: "Wave-based execution planning" },
    { name: "Terminal", description: "Agent terminal sessions and SSE streams" },
    { name: "Breakdown", description: "Beat breakdown planning sessions" },
    { name: "Orchestration", description: "Multi-wave orchestration sessions" },
    { name: "Settings", description: "Application and agent configuration" },
    { name: "Registry", description: "Repository registration and browsing" },
    { name: "System", description: "Diagnostics, version, capabilities, workflows, and history" },
  ],
  paths: {
    ...beatsPaths,
    ...depsPaths,
    ...wavesPaths,
    ...terminalPaths,
    ...breakdownPaths,
    ...orchestrationPaths,
    ...settingsPaths,
    ...registryPaths,
    ...systemPaths,
  },
  components: {
    schemas: componentSchemas,
  },
} as const;
