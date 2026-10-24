/**
 * OpenAPI path definitions for Beads, Terminal, and Orchestration streams.
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
              required: ["beatId"],
              properties: {
                beatId: { type: "string" },
                _repo: { type: "string" },
                prompt: { type: "string" },
              },
            },
            examples: {
              minimal: {
                summary: "Start an agent terminal for a beat",
                value: {
                  beatId: "foolery-ddb9",
                  _repo: "/home/me/foolery",
                },
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

  "/api/terminal/events": {
    get: {
      tags: ["Terminal"],
      summary: "Stream multiplexed terminal session output (SSE)",
      description:
        "Server-Sent Events stream for multiple terminal sessions. Each " +
        "message is a TerminalStreamEnvelope with sessionId and event.",
      operationId: "streamTerminalSessions",
      parameters: [
        {
          name: "sessionIds",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "Comma-separated terminal session IDs to stream.",
        },
      ],
      responses: {
        "200": {
          description: "Multiplexed SSE event stream of terminal output",
          content: {
            "text/event-stream": {
              schema: { $ref: "#/components/schemas/TerminalStreamEnvelope" },
            },
          },
        },
        "400": { description: "No session IDs were requested" },
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
              schema: { $ref: "#/components/schemas/OrchestrationEvent" },
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


export const beadsJournalPaths = {
  "/api/beats/events": {
    get: {
      tags: ["Beats"],
      summary: "Stream Beads journal refresh notices (SSE)",
      operationId: "streamBeadsJournalNotices",
      description:
        "Multiplexes Beads journal notices for the selected repository, or all registered "
        + "repositories when _repo is omitted. The server shares a journal follower and "
        + "current-state mirror per Beads workspace. Each unnamed SSE data frame contains "
        + "a JSON notice; heartbeat comments arrive every 15 seconds. Start in polling mode. "
        + "After ready or change, refetch the filtered GET /api/beats result; notices do not "
        + "contain issue snapshots. Disable periodic polling only while complete is true. "
        + "Mixed Knots/Beads scopes, unsupported Beads versions, disabled journals, and errors "
        + "keep complete false. Journal failures are in-band error notices, not HTTP failures. "
        + "Connection loss should restore polling; reconnect to re-establish readiness. "
        + "No Last-Event-ID or client cursor is required: the server owns clone-local "
        + "checkpoints and rebuilds current state after truncation. Closing the connection "
        + "releases its subscriptions; the last subscriber stops the workspace follower.",
      parameters: [
        {
          $ref: "#/components/parameters/RepoParam",
        },
      ],
      responses: {
        "200": {
          description: "Long-lived SSE stream of JSON refresh notices and heartbeat comments",
          headers: {
            "Cache-Control": { schema: { type: "string", const: "no-cache" } },
            "X-Accel-Buffering": { schema: { type: "string", const: "no" } },
          },
          content: {
            "text/event-stream": {
              schema: {
                type: "object",
                description: "JSON payload in each SSE data frame",
                required: ["type", "complete"],
                properties: {
                  type: {
                    type: "string",
                    enum: ["polling", "ready", "change", "error"],
                    description:
                      "polling: mirror is unavailable or rebuilding; ready: mirror initialized; "
                      + "change: ordered journal mutation applied; error: follower failed.",
                  },
                  repoPath: {
                    type: "string",
                    description: "Workspace path; omitted from the initial polling notice",
                  },
                  message: {
                    type: "string",
                    description: "Diagnostic or journal enablement instructions when applicable",
                  },
                  complete: {
                    type: "boolean",
                    description: "True only when every repository in this scope has a ready mirror",
                  },
                },
              },
              examples: {
                initial: { value: { type: "polling", complete: false } },
                ready: {
                  value: { type: "ready", repoPath: "/home/me/project", complete: true },
                },
                changed: {
                  value: { type: "change", repoPath: "/home/me/project", complete: true },
                },
                failed: {
                  value: { type: "error", repoPath: "/home/me/project",
                    message: "Beads journal follower exited (1)", complete: false },
                },
              },
            },
          },
        },
        "500": { description: "Unable to resolve repository scope before the stream starts" },
      },
    },
  },
} as const;
