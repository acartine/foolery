/**
 * OpenAPI path definition for forced-complete on a persisted execution plan.
 */

export const plansCompletePaths = {
  "/api/plans/{planId}/complete": {
    post: {
      tags: ["Plans"],
      summary: "Force a plan to its positive terminal state",
      description:
        "Marks a persisted execution plan as `shipped` via the workflow's " +
        "force-terminal correction path. Use this when every beat in the " +
        "plan is already terminal but the plan artifact itself is still in " +
        "an in-flight state. Returns the refreshed plan record.",
      operationId: "completePlan",
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description:
            "Plan identifier returned in `artifact.id`.",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["repoPath"],
              properties: {
                repoPath: {
                  type: "string",
                  description:
                    "Absolute repository path that owns the plan.",
                },
              },
            },
            examples: {
              completePlan: {
                value: { repoPath: "/path/to/repo" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Plan completed; refreshed record returned",
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
        "400": {
          description: "Missing repoPath",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                missingRepo: {
                  value: { error: "repoPath is required" },
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
        "409": {
          description: "Plan is already in a terminal state",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                alreadyComplete: {
                  value: {
                    error:
                      "Plan plan-1 is already complete (state=shipped).",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
