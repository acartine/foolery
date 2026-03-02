/**
 * OpenAPI path definitions for dependency endpoints.
 */

export const depsPaths = {
  "/api/beads/{id}/deps": {
    get: {
      tags: ["Dependencies"],
      summary: "Get dependencies for a beat",
      operationId: "getBeatDeps",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Beat identifier" },
        { name: "_repo", in: "query", schema: { type: "string" }, description: "Repository path" },
      ],
      responses: {
        "200": {
          description: "Dependencies list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/BeatDependency" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    post: {
      tags: ["Dependencies"],
      summary: "Add a dependency to a beat",
      operationId: "addBeatDep",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Beat identifier" },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["blocks"],
              properties: {
                blocks: { type: "string", minLength: 1, description: "ID of the blocked beat" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Dependency added",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beads/batch-deps": {
    get: {
      tags: ["Dependencies"],
      summary: "Batch-fetch dependencies for multiple beats",
      operationId: "batchGetDeps",
      parameters: [
        { name: "ids", in: "query", required: true, schema: { type: "string" }, description: "Comma-separated beat IDs" },
        { name: "_repo", in: "query", schema: { type: "string" }, description: "Repository path" },
      ],
      responses: {
        "200": {
          description: "Map of beat ID to dependencies",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    additionalProperties: {
                      type: "array",
                      items: { $ref: "#/components/schemas/BeatDependency" },
                    },
                  },
                },
              },
            },
          },
        },
        "400": { description: "Missing ids parameter", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },
} as const;
