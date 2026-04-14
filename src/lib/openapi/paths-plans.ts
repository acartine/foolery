/**
 * OpenAPI path definitions for persisted execution plans.
 */

export const plansPaths = {
  "/api/plans": {
    get: {
      tags: ["Plans"],
      summary: "List persisted plans for a repository",
      operationId: "listPlans",
      parameters: [
        {
          name: "repoPath",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Persisted plans",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PersistedPlan" },
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Missing repoPath",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    post: {
      tags: ["Plans"],
      summary: "Create and persist an execution plan",
      operationId: "createPlan",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreatePlanRequest" },
          },
        },
      },
      responses: {
        "201": {
          description: "Persisted plan created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePlanResponse" },
            },
          },
        },
        "400": {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}": {
    get: {
      tags: ["Plans"],
      summary: "Get one persisted plan",
      operationId: "getPlan",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Persisted plan",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: { $ref: "#/components/schemas/PersistedPlan" },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}/next": {
    get: {
      tags: ["Plans"],
      summary: "Get the next executable plan step",
      operationId: "getNextPlanStep",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Next executable step or null when complete",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    oneOf: [
                      { $ref: "#/components/schemas/PlanStep" },
                      { type: "null" },
                    ],
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}/steps/{stepId}/start": {
    post: {
      tags: ["Plans"],
      summary: "Start a plan step and spawn beat sessions",
      operationId: "startPlanStep",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "stepId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Step started",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    $ref: "#/components/schemas/PlanStepStartResult",
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan or step not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "409": {
          description: "Step is not executable",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}/steps/{stepId}/complete": {
    post: {
      tags: ["Plans"],
      summary: "Mark a plan step complete",
      operationId: "completePlanStep",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "stepId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Step completed",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    $ref: "#/components/schemas/PlanStepStatusResult",
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan or step not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "409": {
          description: "Beats are not all shipped",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },

  "/api/plans/{planId}/steps/{stepId}/fail": {
    post: {
      tags: ["Plans"],
      summary: "Mark a plan step failed",
      operationId: "failPlanStep",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "stepId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reason: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Step failed and plan aborted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    $ref: "#/components/schemas/PlanStepStatusResult",
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Plan or step not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
} as const;
