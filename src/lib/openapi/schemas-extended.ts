/**
 * Extended OpenAPI 3.1.0 component schemas (split from schemas.ts).
 */

export const extendedComponentSchemas = {
  BackendCapabilities: {
    type: "object",
    properties: {
      canCreate: { type: "boolean" },
      canUpdate: { type: "boolean" },
      canDelete: { type: "boolean" },
      canClose: { type: "boolean" },
      canSearch: { type: "boolean" },
      canQuery: { type: "boolean" },
      canListReady: { type: "boolean" },
      canManageDependencies: { type: "boolean" },
      canManageLabels: { type: "boolean" },
      canSync: { type: "boolean" },
      maxConcurrency: { type: "integer" },
    },
  },

  MemoryWorkflowDescriptor: {
    type: "object",
    required: [
      "id", "backingWorkflowId", "label", "mode",
      "initialState", "states", "terminalStates",
      "retakeState", "promptProfileId",
    ],
    properties: {
      id: { type: "string" },
      backingWorkflowId: { type: "string" },
      label: { type: "string" },
      mode: {
        type: "string",
        enum: ["granular_autonomous", "coarse_human_gated"],
      },
      initialState: { type: "string" },
      states: { type: "array", items: { type: "string" } },
      terminalStates: { type: "array", items: { type: "string" } },
      transitions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
      finalCutState: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      retakeState: { type: "string" },
      promptProfileId: { type: "string" },
      profileId: { type: "string" },
    },
  },

  VersionStatus: {
    type: "object",
    properties: {
      installedVersion: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      latestVersion: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      updateAvailable: { type: "boolean" },
    },
  },

  DoctorReport: {
    type: "object",
    required: ["timestamp", "diagnostics", "summary"],
    properties: {
      timestamp: { type: "string", format: "date-time" },
      diagnostics: {
        type: "array",
        items: {
          type: "object",
          required: ["check", "severity", "message", "fixable"],
          properties: {
            check: { type: "string" },
            severity: {
              type: "string",
              enum: ["error", "warning", "info"],
            },
            message: { type: "string" },
            fixable: { type: "boolean" },
            fixOptions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                },
              },
            },
            context: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          errors: { type: "integer" },
          warnings: { type: "integer" },
          infos: { type: "integer" },
          fixable: { type: "integer" },
        },
      },
    },
  },

  DoctorFixReport: {
    type: "object",
    required: ["timestamp", "results"],
    properties: {
      timestamp: { type: "string", format: "date-time" },
      results: {
        type: "array",
        items: {
          type: "object",
          required: ["check", "success", "message"],
          properties: {
            check: { type: "string" },
            success: { type: "boolean" },
            message: { type: "string" },
            context: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
  },

  AgentHistoryEntry: {
    type: "object",
    required: ["id", "kind", "ts"],
    properties: {
      id: { type: "string" },
      kind: {
        type: "string",
        enum: [
          "session_start", "prompt",
          "response", "session_end",
        ],
      },
      ts: { type: "string", format: "date-time" },
      prompt: { type: "string" },
      promptSource: { type: "string" },
      promptNumber: { type: "integer" },
      workflowState: { type: "string" },
      raw: { type: "string" },
      status: { type: "string" },
      exitCode: {
        oneOf: [{ type: "integer" }, { type: "null" }],
      },
    },
  },

  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
  },
} as const;
