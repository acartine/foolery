const beatIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Beat identifier",
};

const repoProperty = {
  _repo: {
    type: "string",
    description: "Repository path for multi-repo support",
  },
};

const correctionResult = {
  "application/json": {
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
    },
    examples: { success: { value: { ok: true } } },
  },
};

const correctionError = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
    examples: {
      validation: {
        value: {
          error: "Validation failed",
          details: [{ path: ["reason"], message: "Expected string" }],
        },
      },
    },
  },
};

function reasonBody(description: string) {
  return {
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            reason: { type: "string", description },
            ...repoProperty,
          },
        },
        examples: {
          correction: {
            value: {
              reason: "Correcting an accidental workflow action.",
              _repo: "/home/me/foolery",
            },
          },
        },
      },
    },
  };
}

export const beatCorrectionPaths = {
  "/api/beats/{id}/reopen": {
    post: {
      tags: ["Beats"],
      summary: "Reopen a terminal beat",
      description:
        "Correction action that moves a closed or shipped beat back through " +
        "the backend workflow's supported reopen command.",
      operationId: "reopenBeat",
      parameters: [beatIdParam],
      requestBody: reasonBody("Reason shown in the correction history."),
      responses: {
        "200": {
          description: "Beat reopened",
          content: correctionResult,
        },
        "400": {
          description: "Validation or workflow correction failure",
          content: correctionError,
        },
        "404": {
          description: "Beat was not found",
          content: correctionError,
        },
        "500": {
          description: "Backend error",
          content: correctionError,
        },
      },
    },
  },

  "/api/beats/{id}/rollback": {
    post: {
      tags: ["Beats"],
      summary: "Rollback a released Knots beat",
      description:
        "Knots-only release rollback correction. Non-Knots backends return " +
        "400 because the rollback command is workflow-specific.",
      operationId: "rollbackBeatRelease",
      parameters: [beatIdParam],
      requestBody: reasonBody("Reason recorded with the rollback action."),
      responses: {
        "200": {
          description: "Release rollback completed",
          content: correctionResult,
        },
        "400": {
          description: "Validation failure or unsupported backend",
          content: correctionError,
        },
        "404": {
          description: "Beat was not found",
          content: correctionError,
        },
        "500": {
          description: "Rollback command failed",
          content: correctionError,
        },
      },
    },
  },

  "/api/beats/{id}/rewind": {
    post: {
      tags: ["Beats"],
      summary: "Force-rewind a beat to an earlier queue state",
      description:
        "Correction-only action for overshot workflow states. The target " +
        "state must be an earlier non-terminal queue state in the workflow.",
      operationId: "rewindBeat",
      parameters: [beatIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetState"],
              properties: {
                targetState: { type: "string" },
                reason: { type: "string" },
                ...repoProperty,
              },
            },
            examples: {
              correction: {
                value: {
                  targetState: "ready_for_implementation",
                  reason: "Returned to the queue after accidental advancement.",
                  _repo: "/home/me/foolery",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Beat rewound",
          content: correctionResult,
        },
        "400": {
          description: "Validation or workflow rewind failure",
          content: correctionError,
        },
        "404": {
          description: "Beat was not found",
          content: correctionError,
        },
        "500": {
          description: "Backend error",
          content: correctionError,
        },
      },
    },
  },

  "/api/beats/{id}/mark-terminal": {
    post: {
      tags: ["Beats"],
      summary: "Force-mark a beat terminal",
      description:
        "Correction-only action that moves a beat to a terminal workflow " +
        "state and regrooms its ancestors after the backend accepts it.",
      operationId: "markBeatTerminal",
      parameters: [beatIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetState"],
              properties: {
                targetState: { type: "string" },
                reason: { type: "string" },
                ...repoProperty,
              },
            },
            examples: {
              correction: {
                value: {
                  targetState: "shipped",
                  reason: "Correcting terminal state after external release.",
                  _repo: "/home/me/foolery",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Beat marked terminal",
          content: correctionResult,
        },
        "400": {
          description: "Validation or workflow correction failure",
          content: correctionError,
        },
        "404": {
          description: "Beat was not found",
          content: correctionError,
        },
        "500": {
          description: "Backend error",
          content: correctionError,
        },
      },
    },
  },
} as const;
