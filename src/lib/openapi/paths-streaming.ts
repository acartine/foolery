/**
 * OpenAPI path definitions for Terminal, Breakdown, and Orchestration endpoints.
 * Includes SSE streaming endpoints.
 */

export const terminalPaths = {
  "/api/terminal": {
    get: {
      tags: ["Terminal"],
      summary: "List terminal sessions",
      operationId: "listTerminalSessions",
      responses: {
        "200": {
          description: "Active terminal sessions",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/TerminalSession" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Terminal"],
      summary: "Create a terminal session",
      operationId: "createTerminalSession",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["beadId"],
              properties: {
                beadId: { type: "string" },
                _repo: { type: "string" },
                prompt: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Session created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/TerminalSession" } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Terminal"],
      summary: "Abort a terminal session",
      operationId: "abortTerminalSession",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId"],
              properties: { sessionId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Session aborted",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/terminal/{sessionId}": {
    get: {
      tags: ["Terminal"],
      summary: "Stream terminal session output (SSE)",
      description: "Server-Sent Events stream. Content-Type: text/event-stream. Each event is a JSON-encoded TerminalEvent with type stdout, stderr, or exit.",
      operationId: "streamTerminalSession",
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Terminal session ID" },
      ],
      responses: {
        "200": {
          description: "SSE event stream of terminal output",
          content: {
            "text/event-stream": {
              schema: { $ref: "#/components/schemas/TerminalEvent" },
            },
          },
        },
        "404": { description: "Session not found" },
      },
    },
  },
};

export const breakdownPaths = {
  "/api/breakdown": {
    post: {
      tags: ["Breakdown"],
      summary: "Start a breakdown session",
      operationId: "startBreakdown",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["parentBeadId", "_repo"],
              properties: {
                parentBeadId: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Breakdown session started",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/BreakdownSession" } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Breakdown"],
      summary: "Abort a breakdown session",
      operationId: "abortBreakdown",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId"],
              properties: { sessionId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Session aborted",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/breakdown/{sessionId}": {
    get: {
      tags: ["Breakdown"],
      summary: "Stream breakdown session events (SSE)",
      description: "Server-Sent Events stream. Content-Type: text/event-stream. Events include log, plan, status, error, and exit types.",
      operationId: "streamBreakdown",
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Breakdown session ID" },
      ],
      responses: {
        "200": {
          description: "SSE event stream of breakdown progress",
          content: {
            "text/event-stream": {
              schema: { $ref: "#/components/schemas/BreakdownEvent" },
            },
          },
        },
        "404": { description: "Session not found" },
      },
    },
  },

  "/api/breakdown/apply": {
    post: {
      tags: ["Breakdown"],
      summary: "Apply a breakdown plan",
      operationId: "applyBreakdown",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId", "_repo"],
              properties: {
                sessionId: { type: "string" },
                _repo: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Breakdown plan applied",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    properties: {
                      createdBeatIds: { type: "array", items: { type: "string" } },
                      waveCount: { type: "integer" },
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
};

export const orchestrationPaths = {
  "/api/orchestration": {
    get: {
      tags: ["Orchestration"],
      summary: "List orchestration sessions",
      operationId: "listOrchestrations",
      responses: {
        "200": {
          description: "Orchestration sessions",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array", items: { $ref: "#/components/schemas/OrchestrationSession" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["Orchestration"],
      summary: "Start an orchestration session",
      operationId: "startOrchestration",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["_repo"],
              properties: {
                _repo: { type: "string" },
                objective: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Orchestration started",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/OrchestrationSession" } },
              },
            },
          },
        },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
    delete: {
      tags: ["Orchestration"],
      summary: "Abort an orchestration session",
      operationId: "abortOrchestration",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId"],
              properties: { sessionId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Session aborted",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
        },
        "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      },
    },
  },

  "/api/orchestration/{sessionId}": {
    get: {
      tags: ["Orchestration"],
      summary: "Stream orchestration session events (SSE)",
      description: "Server-Sent Events stream. Content-Type: text/event-stream. Events include log, plan, status, error, and exit types.",
      operationId: "streamOrchestration",
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Orchestration session ID" },
      ],
      responses: {
        "200": {
          description: "SSE event stream of orchestration progress",
          content: {
            "text/event-stream": {
              schema: { $ref: "#/components/schemas/BreakdownEvent" },
            },
          },
        },
        "404": { description: "Session not found" },
      },
    },
  },

  "/api/orchestration/apply": {
    post: {
      tags: ["Orchestration"],
      summary: "Apply an orchestration plan",
      operationId: "applyOrchestration",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["sessionId", "_repo"],
              properties: {
                sessionId: { type: "string" },
                _repo: { type: "string" },
                waveNames: { type: "object", additionalProperties: { type: "string" } },
                waveSlugs: { type: "object", additionalProperties: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Orchestration plan applied",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    properties: {
                      applied: { type: "array", items: { $ref: "#/components/schemas/AppliedWaveResult" } },
                      skipped: { type: "array", items: { type: "string" } },
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

  "/api/orchestration/restage": {
    post: {
      tags: ["Orchestration"],
      summary: "Restage orchestration with a manual plan",
      operationId: "restageOrchestration",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["_repo", "plan"],
              properties: {
                _repo: { type: "string" },
                objective: { type: "string" },
                plan: { $ref: "#/components/schemas/OrchestrationPlan" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Restaged orchestration session",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { $ref: "#/components/schemas/OrchestrationSession" } },
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
