/**
 * OpenAPI path definitions for Registry, Doctor, Version, Capabilities,
 * Workflows, Agent History, and OpenRouter endpoints.
 */

export const registryPaths = {
  "/api/registry": {
    get: {
      tags: ["Registry"],
      summary: "List registered repositories",
      operationId: "listRepos",
      responses: {
        "200": {
          description: "Registered repositories",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/RegisteredRepo" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    post: {
      tags: ["Registry"],
      summary: "Register a repository",
      operationId: "addRepo",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["path"],
              properties: { path: { type: "string", minLength: 1 } },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Repository registered",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/RegisteredRepo" } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Registry"],
      summary: "Remove a registered repository",
      operationId: "removeRepo",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["path"],
              properties: { path: { type: "string", minLength: 1 } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Repository removed",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/registry/browse": {
    get: {
      tags: ["Registry"],
      summary: "Browse directories for compatible repositories",
      operationId: "browseDirectories",
      parameters: [
        { name: "path", in: "query", schema: { type: "string" }, description: "Directory path to browse" },
      ],
      responses: {
        "200": {
          description: "Directory entries",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/DirEntry" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },
};

export const systemPaths = {
  "/api/doctor": {
    get: {
      tags: ["System"],
      summary: "Run diagnostics",
      description: "Returns diagnostic report. Set stream=1 for NDJSON streaming.",
      operationId: "runDiagnostics",
      parameters: [
        { name: "stream", in: "query", schema: { type: "string", enum: ["1"] }, description: "Enable NDJSON streaming" },
      ],
      responses: {
        "200": {
          description: "Diagnostic report",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/DoctorReport" },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    post: {
      tags: ["System"],
      summary: "Fix diagnosed issues",
      operationId: "fixIssues",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                strategies: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description: "Map of check name to fix strategy key",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Fix report",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/DoctorFixReport" },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/version": {
    get: {
      tags: ["System"],
      summary: "Get version status",
      operationId: "getVersion",
      parameters: [
        { name: "force", in: "query", schema: { type: "string", enum: ["1"] }, description: "Force fresh check" },
      ],
      responses: {
        "200": {
          description: "Version information",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { $ref: "#/components/schemas/VersionStatus" },
                },
              },
            },
          },
        },
      },
    },
  },

  "/api/capabilities": {
    get: {
      tags: ["System"],
      summary: "Get backend capabilities",
      operationId: "getCapabilities",
      parameters: [
        { name: "repo", in: "query", schema: { type: "string" }, description: "Repository path" },
      ],
      responses: {
        "200": {
          description: "Backend capability flags",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { $ref: "#/components/schemas/BackendCapabilities" },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/workflows": {
    get: {
      tags: ["System"],
      summary: "List available workflows",
      operationId: "listWorkflows",
      parameters: [
        { name: "_repo", in: "query", schema: { type: "string" }, description: "Repository path" },
      ],
      responses: {
        "200": {
          description: "Available workflow descriptors",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/MemoryWorkflowDescriptor" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/agent-history": {
    get: {
      tags: ["System"],
      summary: "Get agent interaction history",
      operationId: "getAgentHistory",
      parameters: [
        { name: "_repo", in: "query", schema: { type: "string" }, description: "Repository path" },
        { name: "beadId", in: "query", schema: { type: "string" }, description: "Filter by beat ID" },
        { name: "beadRepo", in: "query", schema: { type: "string" }, description: "Filter by beat repo" },
        { name: "sinceHours", in: "query", schema: { type: "string" }, description: "Limit to recent N hours" },
      ],
      responses: {
        "200": {
          description: "Agent history entries",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/AgentHistoryEntry" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/agent-history/message-types": {
    get: {
      tags: ["System"],
      summary: "Get agent message type index",
      operationId: "getMessageTypeIndex",
      responses: {
        "200": {
          description: "Message type index mapping",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    description: "Index of message types observed in agent interactions",
                    additionalProperties: true,
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

  "/api/openrouter/models": {
    get: {
      tags: ["OpenRouter"],
      summary: "List available OpenRouter models",
      operationId: "listOpenRouterModels",
      responses: {
        "200": {
          description: "Available models",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/OpenRouterModel" } },
                },
              },
            },
          },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/openrouter/validate": {
    post: {
      tags: ["OpenRouter"],
      summary: "Validate an OpenRouter API key",
      operationId: "validateOpenRouterKey",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["apiKey"],
              properties: { apiKey: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Validation result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: { valid: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },
} as const;
