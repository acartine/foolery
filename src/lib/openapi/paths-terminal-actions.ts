const sessionIdParam = {
  name: "sessionId",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Terminal session identifier",
};

const approvalIdParam = {
  name: "approvalId",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Approval escalation identifier",
};

const errorJson = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
    examples: { notFound: { value: { error: "Session not found" } } },
  },
};

const terminalSessionJson = {
  "application/json": {
    schema: {
      type: "object",
      properties: { data: { $ref: "#/components/schemas/TerminalSession" } },
    },
  },
};

function terminalStopOperation(
  action: "kill" | "terminate",
  operationId: string,
) {
  return {
    tags: ["Terminal"],
    summary: action === "kill"
      ? "Force-kill a terminal session"
      : "Gracefully terminate a terminal session",
    operationId,
    parameters: [sessionIdParam],
    responses: {
      "200": {
        description: "Updated terminal session",
        content: terminalSessionJson,
      },
      "404": {
        description: "Session was not found",
        content: errorJson,
      },
      "410": {
        description: "Session already exited",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string" },
                status: { type: "string" },
              },
            },
            examples: {
              exited: {
                value: { error: "Session already exited", status: "completed" },
              },
            },
          },
        },
      },
    },
  };
}

const respondBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 8000 },
        },
      },
      examples: { response: { value: { text: "Please run the safer command." } } },
    },
  },
};

export const terminalActionPaths = {
  "/api/terminal/{sessionId}/kill": {
    post: terminalStopOperation("kill", "killTerminalSession"),
  },

  "/api/terminal/{sessionId}/terminate": {
    post: terminalStopOperation("terminate", "terminateTerminalSession"),
  },

  "/api/terminal/{sessionId}/approvals/{approvalId}/respond": {
    post: {
      tags: ["Terminal"],
      summary: "Respond to a terminal approval escalation",
      operationId: "respondToTerminalApproval",
      parameters: [sessionIdParam, approvalIdParam],
      requestBody: respondBody,
      responses: {
        "200": {
          description: "Approval response recorded",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    properties: {
                      approvalId: { type: "string" },
                      action: { type: "string", enum: ["respond"] },
                      status: { type: "string" },
                    },
                  },
                },
              },
              examples: {
                success: {
                  value: {
                    data: {
                      approvalId: "approval-123",
                      action: "respond",
                      status: "responded",
                    },
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Response text is missing or too long",
          content: errorJson,
        },
        "404": {
          description: "Session or approval was not found",
          content: errorJson,
        },
        "409": {
          description: "Approval is no longer pending",
          content: errorJson,
        },
      },
    },
  },

  "/api/terminal/{sessionId}/approvals/claude-bridge": {
    post: {
      tags: ["Terminal"],
      summary: "Bridge a Claude permission prompt into Foolery approvals",
      operationId: "bridgeClaudeApprovalRequest",
      parameters: [sessionIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                tool_use_id: { type: "string" },
                input: { type: "object", additionalProperties: true },
              },
              additionalProperties: true,
            },
            examples: {
              permissionPrompt: {
                value: {
                  tool_name: "Bash",
                  tool_use_id: "toolu_123",
                  input: { command: "bun run test" },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Bridge decision for the waiting Claude process",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          behavior: { type: "string", enum: ["allow"] },
                          updatedInput: { type: "object", additionalProperties: true },
                        },
                      },
                      {
                        type: "object",
                        properties: {
                          behavior: { type: "string", enum: ["deny"] },
                          message: { type: "string" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        "403": {
          description: "Approval bridge token is invalid",
          content: errorJson,
        },
        "404": {
          description: "Session was not found",
          content: errorJson,
        },
      },
    },
  },
} as const;
