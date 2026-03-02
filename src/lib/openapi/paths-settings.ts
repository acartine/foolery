/**
 * OpenAPI path definitions for Settings and Agent management endpoints.
 */

export const settingsPaths = {
  "/api/settings": {
    get: {
      tags: ["Settings"],
      summary: "Get application settings",
      operationId: "getSettings",
      responses: {
        "200": {
          description: "Current settings",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/FoolerySettings" },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    put: {
      tags: ["Settings"],
      summary: "Replace settings",
      operationId: "replaceSettings",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FoolerySettings" },
          },
        },
      },
      responses: {
        "200": {
          description: "Settings replaced",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/FoolerySettings" },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    patch: {
      tags: ["Settings"],
      summary: "Merge-update settings",
      operationId: "patchSettings",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FoolerySettings" },
          },
        },
      },
      responses: {
        "200": {
          description: "Settings updated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/FoolerySettings" },
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

  "/api/settings/agents": {
    get: {
      tags: ["Settings"],
      summary: "List registered agents",
      operationId: "listAgents",
      responses: {
        "200": {
          description: "Registered agents",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/RegisteredAgent" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Settings"],
      summary: "Add a registered agent",
      operationId: "addAgent",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["id", "command"],
              properties: {
                id: { type: "string" },
                command: { type: "string" },
                model: { type: "string" },
                label: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Agent added, returns updated list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/RegisteredAgent" } },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Settings"],
      summary: "Remove a registered agent",
      operationId: "removeAgent",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Agent removed, returns updated list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/RegisteredAgent" } },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/settings/actions": {
    get: {
      tags: ["Settings"],
      summary: "Get action settings",
      operationId: "getActions",
      responses: {
        "200": {
          description: "Current action settings",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    put: {
      tags: ["Settings"],
      summary: "Replace action settings",
      operationId: "replaceActions",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        "200": {
          description: "Action settings replaced",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/settings/agents/scan": {
    get: {
      tags: ["Settings"],
      summary: "Scan for available agent CLIs",
      operationId: "scanAgents",
      responses: {
        "200": {
          description: "Scanned agents",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/ScannedAgent" } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
