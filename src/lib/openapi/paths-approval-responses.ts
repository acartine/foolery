const approvalIdParam = {
  name: "approvalId",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Approval escalation identifier",
};

const approvalRespondBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["text"],
        properties: {
          text: {
            type: "string",
            minLength: 1,
            maxLength: 8000,
            description: "User response text to send back to the agent.",
          },
        },
      },
      examples: {
        clarification: {
          value: { text: "Use the existing config file and keep the change scoped." },
        },
      },
    },
  },
};

const approvalActionResult = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        action: { type: "string", enum: ["respond"] },
        status: { type: "string" },
        record: { $ref: "#/components/schemas/ApprovalEscalation" },
      },
    },
  },
};

const jsonError = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
    examples: {
      missingText: { value: { error: "Response text is required" } },
    },
  },
};

export const approvalResponsePaths = {
  "/api/approvals/{approvalId}/respond": {
    post: {
      tags: ["Approvals"],
      summary: "Respond to an approval escalation",
      operationId: "respondToApproval",
      parameters: [approvalIdParam],
      requestBody: approvalRespondBody,
      responses: {
        "200": {
          description: "Approval response recorded",
          content: {
            "application/json": {
              schema: approvalActionResult,
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
          description: "Response text is empty or too long",
          content: jsonError,
        },
        "404": {
          description: "Approval record was not found",
          content: jsonError,
        },
        "409": {
          description: "Approval is no longer pending",
          content: jsonError,
        },
      },
    },
  },
} as const;
