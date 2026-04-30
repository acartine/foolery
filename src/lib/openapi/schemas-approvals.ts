/**
 * OpenAPI 3.1.0 schemas for the canonical Approval Escalation API.
 */

export const approvalComponentSchemas = {
  ApprovalAction: {
    type: "string",
    enum: ["approve", "always_approve", "reject"],
  },

  ApprovalEscalationStatus: {
    type: "string",
    enum: [
      "pending",
      "responding",
      "approved",
      "always_approved",
      "rejected",
      "manual_required",
      "dismissed",
      "reply_failed",
      "unsupported",
    ],
  },

  ApprovalReplyTarget: {
    type: "object",
    required: ["adapter", "transport"],
    properties: {
      adapter: { type: "string" },
      transport: {
        type: "string",
        enum: ["http", "jsonrpc", "acp", "stdio"],
      },
      nativeSessionId: { type: "string" },
      requestId: { type: "string" },
      permissionId: { type: "string" },
    },
  },

  ApprovalAgentInfo: {
    type: "object",
    properties: {
      provider: { type: "string" },
      name: { type: "string" },
      model: { type: "string" },
      version: { type: "string" },
    },
  },

  ApprovalEscalation: {
    type: "object",
    required: [
      "id",
      "notificationKey",
      "status",
      "sessionId",
      "adapter",
      "source",
      "options",
      "patterns",
      "supportedActions",
      "createdAt",
      "updatedAt",
      "actionable",
    ],
    properties: {
      id: {
        type: "string",
        description:
          "Stable approval identifier (also referred to as approvalId).",
      },
      notificationKey: { type: "string" },
      status: {
        $ref: "#/components/schemas/ApprovalEscalationStatus",
      },
      sessionId: {
        type: "string",
        description: "Originating terminal session ID.",
      },
      beatId: { type: "string" },
      beatTitle: { type: "string" },
      repoPath: { type: "string" },
      adapter: { type: "string" },
      source: { type: "string" },
      message: { type: "string" },
      question: { type: "string" },
      serverName: { type: "string" },
      toolName: { type: "string" },
      toolParamsDisplay: { type: "string" },
      parameterSummary: { type: "string" },
      toolUseId: { type: "string" },
      nativeSessionId: { type: "string" },
      requestId: { type: "string" },
      permissionId: { type: "string" },
      permissionName: { type: "string" },
      patterns: { type: "array", items: { type: "string" } },
      options: { type: "array", items: { type: "string" } },
      supportedActions: {
        type: "array",
        items: { $ref: "#/components/schemas/ApprovalAction" },
      },
      replyTarget: {
        $ref: "#/components/schemas/ApprovalReplyTarget",
      },
      agent: {
        $ref: "#/components/schemas/ApprovalAgentInfo",
      },
      failureReason: {
        type: "string",
        description:
          "Raw reason returned by the responder when the " +
          "last reply attempt produced reply_failed or " +
          "unsupported. Cleared when a fresh attempt is " +
          "sent or the approval reaches a terminal status.",
      },
      createdAt: { type: "number" },
      updatedAt: { type: "number" },
      actionable: { type: "boolean" },
      actionableReason: { type: "string" },
    },
  },

  ApprovalActionRequest: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        $ref: "#/components/schemas/ApprovalAction",
      },
    },
  },

  ApprovalActionResponse: {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        required: ["approvalId", "action", "status"],
        properties: {
          approvalId: { type: "string" },
          action: {
            $ref: "#/components/schemas/ApprovalAction",
          },
          status: {
            $ref: "#/components/schemas/ApprovalEscalationStatus",
          },
          record: {
            $ref: "#/components/schemas/ApprovalEscalation",
          },
        },
      },
    },
  },

  ApprovalActionErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
      code: { type: "string" },
      record: {
        $ref: "#/components/schemas/ApprovalEscalation",
      },
    },
  },
} as const;
