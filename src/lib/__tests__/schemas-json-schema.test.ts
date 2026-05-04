import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { foolerySettingsSchema } from "@/lib/schemas";

type JsonSchemaNode = {
  $schema?: string;
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: JsonSchemaNode | boolean;
  items?: JsonSchemaNode;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: readonly unknown[];
  anyOf?: JsonSchemaNode[];
};

function toJsonSchema(): JsonSchemaNode {
  return z.toJSONSchema(foolerySettingsSchema, {
    target: "draft-2020-12",
  }) as JsonSchemaNode;
}

const TOP_LEVEL_KEYS = [
  "agents",
  "actions",
  "backend",
  "defaults",
  "scopeRefinement",
  "pools",
  "dispatchMode",
  "maxConcurrentSessions",
  "maxClaimsPerQueueType",
  "terminalLightTheme",
] as const;

const POOL_STEPS = [
  "orchestration",
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
  "scope_refinement",
  "stale_grooming",
] as const;

describe("foolerySettingsSchema → JSON Schema", () => {
  it("emits Draft 2020-12 output with a root-level description", () => {
    const schema = toJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.description).toMatch(/settings\.toml/);
    expect(schema.description).toMatch(/src\/lib\/schemas\.ts/);
  });

  it("includes every top-level settings key", () => {
    const schema = toJsonSchema();
    const props = schema.properties ?? {};
    for (const key of TOP_LEVEL_KEYS) {
      expect(props).toHaveProperty(key);
    }
  });

  it("carries describe() text through to property descriptions", () => {
    const schema = toJsonSchema();
    const props = schema.properties ?? {};
    for (const key of TOP_LEVEL_KEYS) {
      const node = props[key];
      expect(node, `missing node for ${key}`).toBeDefined();
      expect(node?.description, `missing description for ${key}`)
        .toMatch(/\S/);
    }
  });

  it("mentions the agent-id convention in the agents description", () => {
    const schema = toJsonSchema();
    const agents = schema.properties?.agents;
    expect(agents?.description).toMatch(/<vendor>-<model-slug>/);
  });

  it("enumerates all canonical pool step keys with descriptions", () => {
    const schema = toJsonSchema();
    const poolsProps = schema.properties?.pools?.properties ?? {};
    for (const step of POOL_STEPS) {
      expect(poolsProps, `missing pool step ${step}`).toHaveProperty(step);
      expect(poolsProps[step]?.description).toMatch(/\S/);
    }
  });

  it("allows additional pool step keys via additionalProperties", () => {
    const schema = toJsonSchema();
    const pools = schema.properties?.pools;
    expect(pools?.additionalProperties).toBeTruthy();
  });

  it("documents the scopeRefinement placeholder convention", () => {
    const schema = toJsonSchema();
    const prompt = schema.properties?.scopeRefinement?.properties?.prompt;
    expect(prompt?.description).toMatch(/\{\{title\}\}/);
    expect(prompt?.description).toMatch(/\{\{description\}\}/);
    expect(prompt?.description).toMatch(/\{\{acceptance\}\}/);
  });

  it("encodes numeric ranges for integer settings", () => {
    const schema = toJsonSchema();
    const mcs = schema.properties?.maxConcurrentSessions;
    expect(mcs?.minimum).toBe(1);
    expect(mcs?.maximum).toBe(20);

    const mcq = schema.properties?.maxClaimsPerQueueType;
    expect(mcq?.minimum).toBe(1);
    expect(mcq?.maximum).toBe(50);
  });

  it("encodes enum values for dispatchMode and backend.type", () => {
    const schema = toJsonSchema();
    expect(schema.properties?.dispatchMode?.enum).toEqual([
      "basic",
      "advanced",
    ]);
    const backendType = schema.properties?.backend?.properties?.type;
    expect(backendType?.enum).toEqual([
      "auto",
      "cli",
      "stub",
      "beads",
      "knots",
    ]);
  });
});
