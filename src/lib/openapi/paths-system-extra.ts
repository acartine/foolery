const errorJson = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
    examples: { error: { value: { error: "Invalid diagnostics payload" } } },
  },
};

const okJson = {
  "application/json": {
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
    },
    examples: { success: { value: { ok: true } } },
  },
};

export const systemExtraPaths = {
  "/api/openapi.json": {
    get: {
      tags: ["System"],
      summary: "Get the Foolery OpenAPI contract",
      operationId: "getOpenApiSpec",
      responses: {
        "200": {
          description: "OpenAPI 3.1 document",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
              examples: {
                success: {
                  value: {
                    openapi: "3.1.0",
                    info: { title: "Foolery API" },
                    paths: {},
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  "/api/docs": {
    get: {
      tags: ["System"],
      summary: "Render interactive API documentation",
      operationId: "getApiDocs",
      responses: {
        "200": {
          description: "ReDoc HTML page for the OpenAPI contract",
          content: {
            "text/html": {
              schema: { type: "string" },
              examples: { success: { value: "<!DOCTYPE html><html>...</html>" } },
            },
          },
        },
      },
    },
  },

  "/api/app-update": {
    get: {
      tags: ["System"],
      summary: "Get app update status",
      operationId: "getAppUpdateStatus",
      responses: {
        "200": {
          description: "Current update status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    properties: {
                      phase: { type: "string" },
                      message: { type: ["string", "null"] },
                      error: { type: ["string", "null"] },
                      startedAt: { type: ["number", "null"] },
                      endedAt: { type: ["number", "null"] },
                      workerPid: { type: ["number", "null"] },
                      launcherPath: { type: ["string", "null"] },
                      fallbackCommand: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["System"],
      summary: "Start a local app update",
      operationId: "startAppUpdate",
      responses: {
        "202": {
          description: "Update worker started",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "string" } },
              },
              examples: { started: { value: { data: "starting" } } },
            },
          },
        },
        "403": {
          description: "Request origin is not allowed to trigger updates",
          content: errorJson,
        },
        "409": {
          description: "An update is already running or cannot start now",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "string" } },
              },
            },
          },
        },
        "500": {
          description: "Update worker failed to start",
          content: errorJson,
        },
      },
    },
  },

  "/api/diagnostics/perf": {
    post: {
      tags: ["System"],
      summary: "Ingest client performance diagnostics",
      operationId: "ingestClientPerfDiagnostics",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["schemaVersion", "events"],
              properties: {
                schemaVersion: { type: "integer", enum: [1] },
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "ts", "schemaVersion", "kind"],
                    properties: {
                      id: { type: "string" },
                      ts: { type: "string", format: "date-time" },
                      schemaVersion: { type: "integer", enum: [1] },
                      kind: { type: "string" },
                    },
                    additionalProperties: true,
                  },
                },
              },
            },
            examples: {
              batch: {
                value: {
                  schemaVersion: 1,
                  events: [
                    {
                      id: "perf-1",
                      ts: "2026-06-09T12:00:00.000Z",
                      schemaVersion: 1,
                      kind: "api_timing",
                      label: "GET /api/beats",
                      durationMs: 42,
                      ok: true,
                    },
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Diagnostics batch accepted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  count: { type: "integer", minimum: 0 },
                },
              },
              examples: { success: { value: { ok: true, count: 1 } } },
            },
          },
        },
        "400": {
          description: "Malformed diagnostics payload",
          content: errorJson,
        },
      },
    },
  },

  "/api/lease-audit": {
    get: {
      tags: ["System"],
      summary: "Get lease audit events and aggregates",
      operationId: "getLeaseAudit",
      parameters: [
        { name: "repoPath", in: "query", schema: { type: "string" } },
        { name: "queueType", in: "query", schema: { type: "string" } },
        { name: "agent", in: "query", schema: { type: "string" } },
        { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
        { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
        { name: "preset", in: "query", schema: { type: "string", enum: ["last24h", "last7d"] } },
      ],
      responses: {
        "200": {
          description: "Lease audit data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  events: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                  aggregates: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
        "500": {
          description: "Audit logs could not be read",
          content: errorJson,
        },
      },
    },
    delete: {
      tags: ["System"],
      summary: "Reset lease audit logs",
      operationId: "resetLeaseAudit",
      responses: {
        "200": {
          description: "Audit logs truncated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  truncated: { type: "array", items: { type: "string" } },
                },
              },
              examples: {
                success: { value: { ok: true, truncated: ["/tmp/lease-audit.jsonl"] } },
              },
            },
          },
        },
        "500": {
          description: "Audit logs could not be reset",
          content: errorJson,
        },
      },
    },
  },

  "/api/test/terminal-fixture": {
    get: {
      tags: ["System"],
      summary: "List terminal fixture sessions when the E2E fixture is enabled",
      operationId: "listTerminalFixtureSessions",
      responses: {
        "200": {
          description: "Fixture terminal sessions",
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
        "404": {
          description: "Terminal fixture is disabled",
          content: errorJson,
        },
      },
    },
    post: {
      tags: ["System"],
      summary: "Mutate terminal fixture sessions when the E2E fixture is enabled",
      operationId: "mutateTerminalFixtureSession",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["action"],
              properties: {
                action: { type: "string", enum: ["clear", "create", "event"] },
                id: { type: "string" },
                sessionId: { type: "string" },
                event: { $ref: "#/components/schemas/TerminalEvent" },
              },
              additionalProperties: true,
            },
            examples: { clear: { value: { action: "clear" } } },
          },
        },
      },
      responses: {
        "200": {
          description: "Fixture action applied",
          content: okJson,
        },
        "400": {
          description: "Unknown fixture action",
          content: errorJson,
        },
        "404": {
          description: "Fixture is disabled or session was not found",
          content: errorJson,
        },
      },
    },
  },
} as const;
