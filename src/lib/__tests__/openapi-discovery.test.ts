import { describe, expect, it } from "vitest";
import { openApiSpec } from "@/lib/openapi-spec";
import {
  agentGuideMarkdown,
  discoveryDocument,
  API_VERSION,
} from "@/lib/openapi/agent-guide";

/**
 * Hermetic discoverability contract for the agent-friendly API resource.
 * Asserts only on the static spec object + discovery document — no env, fs,
 * network, or host binaries (Hermetic Test Policy).
 */
describe("OpenAPI agent discoverability", () => {
  const paths = openApiSpec.paths as Record<string, Record<string, unknown>>;

  it("exposes the core repo-scoped and system paths agents need", () => {
    const required = [
      "/api/beats",
      "/api/registry",
      "/api/settings",
      "/api/terminal",
      "/api/plans",
      "/api/beats/stale-grooming",
      "/api/workflows",
    ];
    for (const p of required) {
      expect(paths, `missing path ${p}`).toHaveProperty([p]);
    }
  });

  it("gives every operation an operationId and tags", () => {
    for (const [path, ops] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const operation = op as { operationId?: string; tags?: string[] };
        expect(operation.operationId, `${method} ${path} operationId`)
          .toBeTruthy();
        expect(operation.tags?.length, `${method} ${path} tags`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("embeds the agent guide (base URL, registry, envelopes) in info", () => {
    const description = openApiSpec.info.description;
    expect(description).toContain(agentGuideMarkdown);
    expect(description.toLowerCase()).toContain("base url");
    expect(description).toContain("/api/registry");
    expect(description).toContain("_repo");
    expect(description.toLowerCase()).toContain("envelope");
  });

  it("advertises base URLs and the discovery extension", () => {
    expect(openApiSpec.servers[0].url).toBe("/");
    const urls = openApiSpec.servers.map((s) => s.url);
    expect(urls).toContain("http://localhost:3000");
    expect(urls).toContain("http://localhost:3210");
    expect(openApiSpec["x-agent-discovery"]).toBe("/.well-known/foolery.json");
  });

  it("defines the reusable RepoParam parameter", () => {
    const params = openApiSpec.components.parameters as Record<string, unknown>;
    expect(params).toHaveProperty(["RepoParam"]);
  });

  it("documents both discovery routes against the DiscoveryDocument schema", () => {
    expect(paths).toHaveProperty(["/.well-known/foolery.json"]);
    expect(paths).toHaveProperty(["/api/discovery"]);
    const schemas = openApiSpec.components.schemas as Record<string, unknown>;
    expect(schemas).toHaveProperty(["DiscoveryDocument"]);
  });
});

describe("discovery document", () => {
  it("links the spec, docs, and registry for machine discovery", () => {
    expect(discoveryDocument.openapi).toBe("/api/openapi.json");
    expect(discoveryDocument.docs).toBe("/api/docs");
    expect(discoveryDocument.endpoints.registry).toBe("/api/registry");
    expect(discoveryDocument.apiVersion).toBe(API_VERSION);
  });

  it("describes the repo-selector convention and a quickstart", () => {
    expect(discoveryDocument.conventions.repoSelector).toBe("_repo");
    expect(discoveryDocument.quickstart.length).toBeGreaterThan(0);
  });

  it("does not hardcode workflow state names as a contract", () => {
    const serialized = JSON.stringify(discoveryDocument);
    expect(serialized).not.toContain("ready_for_");
  });
});
