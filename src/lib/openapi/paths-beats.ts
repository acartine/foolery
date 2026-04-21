/**
 * OpenAPI path definitions for Beat CRUD and action endpoints.
 */

const repoParam = {
  name: "_repo",
  in: "query" as const,
  schema: { type: "string" },
  description: "Repository path for multi-repo support",
};

const beatIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Beat identifier",
};

export const beatsPaths = {
  "/api/beats": {
    get: {
      tags: ["Beats"],
      summary: "List beats",
      operationId: "listBeats",
      parameters: [
        repoParam,
        { name: "q", in: "query", schema: { type: "string" }, description: "Search query" },
        { name: "status", in: "query", schema: { type: "string" }, description: "Filter by status" },
        { name: "type", in: "query", schema: { type: "string" }, description: "Filter by type" },
        { name: "priority", in: "query", schema: { type: "string" }, description: "Filter by priority" },
        { name: "assignee", in: "query", schema: { type: "string" }, description: "Filter by assignee" },
        { name: "labels", in: "query", schema: { type: "string" }, description: "Filter by labels" },
      ],
      responses: {
        "200": {
          description: "List of beats",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/Beat" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "503": { description: "Backend degraded" },
      },
    },
    post: {
      tags: ["Beats"],
      summary: "Create a beat",
      operationId: "createBeat",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title"],
              properties: {
                title: { type: "string", minLength: 1 },
                description: { type: "string" },
                type: { type: "string", default: "work" },
                priority: { type: "integer", enum: [0, 1, 2, 3, 4], default: 2 },
                labels: { type: "array", items: { type: "string" }, default: [] },
                assignee: { type: "string" },
                due: { type: "string" },
                acceptance: { type: "string" },
                notes: { type: "string" },
                parent: { type: "string" },
                estimate: { type: "integer", minimum: 1 },
                profileId: { type: "string" },
                workflowId: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Beat created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/Beat" } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/{id}": {
    get: {
      tags: ["Beats"],
      summary: "Get a beat by ID",
      operationId: "getBeat",
      parameters: [beatIdParam, repoParam],
      responses: {
        "200": {
          description: "Beat found",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { $ref: "#/components/schemas/Beat" },
                  cached: { type: "boolean" },
                  cachedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        "404": { description: "Beat not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    patch: {
      tags: ["Beats"],
      summary: "Update a beat",
      operationId: "updateBeat",
      parameters: [beatIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                type: { type: "string" },
                state: { type: "string" },
                profileId: { type: "string" },
                priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
                parent: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                removeLabels: { type: "array", items: { type: "string" } },
                assignee: { type: "string" },
                due: { type: "string" },
                acceptance: { type: "string" },
                notes: { type: "string" },
                estimate: { type: "integer", minimum: 1 },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Beat updated",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Beats"],
      summary: "Delete/archive a beat",
      operationId: "deleteBeat",
      parameters: [beatIdParam, repoParam],
      responses: {
        "200": {
          description: "Beat deleted",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/{id}/close": {
    post: {
      tags: ["Beats"],
      summary: "Close a beat",
      operationId: "closeBeat",
      parameters: [beatIdParam],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reason: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Beat closed",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/{id}/close-cascade": {
    post: {
      tags: ["Beats"],
      summary: "Close a beat and its descendants",
      description: "When confirmed=false, returns a preview of affected descendants. When confirmed=true, closes the beat and all descendants.",
      operationId: "closeBeatCascade",
      parameters: [beatIdParam],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                confirmed: { type: "boolean", default: false },
                reason: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Preview (confirmed=false) or close result (confirmed=true)",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    oneOf: [
                      {
                        type: "object",
                        properties: { descendants: { type: "array", items: { $ref: "#/components/schemas/Beat" } } },
                      },
                      {
                        type: "object",
                        properties: { closedCount: { type: "integer" } },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/{id}/refine-scope": {
    post: {
      tags: ["Scope refinement"],
      summary: "Enqueue a scope refinement job for a beat",
      description:
        "Queues the configured scope-refinement agent to re-evaluate the beat's " +
        "acceptance criteria. Returns 503 when no scope-refinement agent is configured.",
      operationId: "refineBeatScope",
      parameters: [beatIdParam],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                _repo: { type: "string", description: "Repository path for multi-repo support" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Scope refinement job enqueued",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      jobId: { type: "string" },
                      beatId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        "503": {
          description: "Scope refinement agent not configured",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
      },
    },
  },

  "/api/beats/ready": {
    get: {
      tags: ["Beats"],
      summary: "List ready beats",
      operationId: "listReadyBeats",
      parameters: [repoParam, { name: "q", in: "query", schema: { type: "string" }, description: "Search query" }],
      responses: {
        "200": {
          description: "Ready beats",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "array", items: { $ref: "#/components/schemas/Beat" } } },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/query": {
    post: {
      tags: ["Beats"],
      summary: "Advanced beat query",
      operationId: "queryBeats",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["expression"],
              properties: {
                expression: { type: "string", minLength: 1 },
                limit: { type: "integer", default: 50, minimum: 1 },
                sort: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Query results",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "array", items: { $ref: "#/components/schemas/Beat" } } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/beats/merge": {
    post: {
      tags: ["Beats"],
      summary: "Merge two beats",
      operationId: "mergeBeats",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["survivorId", "consumedId"],
              properties: {
                survivorId: { type: "string" },
                consumedId: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Merge result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      survivorId: { type: "string" },
                      consumedId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },
} as const;
