/**
 * OpenAPI 3.1.0 path definitions for the canonical Approval Escalation API
 * plus the legacy session-scoped compatibility endpoint.
 */

const errorResponse = {
  description: "Error",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
};

export const approvalsPaths = {
  "/api/approvals": {
    get: {
      tags: ["Approvals"],
      summary: "List approval escalations",
      description:
        "Returns the canonical, session-independent approval escalation queue. " +
        "Approvals remain visible after the originating terminal session is " +
        "cleaned up; in that case `actionable` is false and " +
        "`actionableReason` describes why no responder is available.",
      operationId: "listApprovals",
      parameters: [
        {
          name: "_repo",
          in: "query",
          schema: { type: "string" },
          description: "Filter by repository path.",
        },
        {
          name: "active",
          in: "query",
          schema: { type: "boolean" },
          description:
            "When true, returns only approvals whose status is not terminal.",
        },
        {
          name: "status",
          in: "query",
          schema: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ApprovalEscalationStatus",
            },
          },
          style: "form",
          explode: true,
          description:
            "Filter by status. Repeatable (?status=pending&status=responding) " +
            "or comma-separated (?status=pending,responding).",
        },
        {
          name: "updatedSince",
          in: "query",
          schema: { type: "integer" },
          description:
            "Only return approvals whose updatedAt is >= this epoch-ms cursor.",
        },
      ],
      responses: {
        "200": {
          description: "Approval escalations",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "array",
                    items: {
                      $ref:
                        "#/components/schemas/ApprovalEscalation",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },

  "/api/approvals/{approvalId}/actions": {
    post: {
      tags: ["Approvals"],
      summary: "Apply an approval action",
      description:
        "Approve, always_approve, or reject the approval escalation. " +
        "Returns 409 when the originating session/responder is no longer " +
        "available; the record stays in the queue for manual handling.",
      operationId: "applyApprovalAction",
      parameters: [
        {
          name: "approvalId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApprovalActionRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Approval action delegated to runtime responder",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ApprovalActionResponse",
              },
            },
          },
        },
        "400": {
          description: "Invalid action",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Approval not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "409": {
          description:
            "Approval is no longer programmatically actionable",
          content: {
            "application/json": {
              schema: {
                $ref:
                  "#/components/schemas/ApprovalActionErrorResponse",
              },
            },
          },
        },
        "502": {
          description: "Responder failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/terminal/{sessionId}/approvals/{approvalId}": {
    post: {
      tags: ["Approvals"],
      summary:
        "Apply an approval action via session-scoped compat route",
      description:
        "Compatibility wrapper that verifies the terminal session exists, " +
        "then delegates to the canonical " +
        "POST /api/approvals/{approvalId}/actions implementation.",
      operationId: "applyTerminalApprovalAction",
      parameters: [
        {
          name: "sessionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "approvalId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApprovalActionRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Approval action delegated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    properties: {
                      approvalId: { type: "string" },
                      action: {
                        $ref:
                          "#/components/schemas/ApprovalAction",
                      },
                      status: {
                        $ref:
                          "#/components/schemas/ApprovalEscalationStatus",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "400": errorResponse,
        "404": errorResponse,
        "409": errorResponse,
        "502": errorResponse,
      },
    },
  },
} as const;
