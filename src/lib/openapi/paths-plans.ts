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
          description: "Persisted plan summaries",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PlanSummary" },
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
      summary: "Create and persist an immutable execution plan",
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
      summary: "Get one persisted plan with derived progress",
      operationId: "getPlan",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "repoPath",
          in: "query",
          required: false,
          schema: { type: "string" },
          description:
            "Optional repo hint for disambiguation when multiple registered repos may match.",
        },
      ],
      responses: {
        "200": {
          description: "Persisted plan and derived progress",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    $ref: "#/components/schemas/PersistedPlan",
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
} as const;
