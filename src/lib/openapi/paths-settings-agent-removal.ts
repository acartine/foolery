const jsonError = {
  "application/json": {
    schema: { $ref: "#/components/schemas/ErrorResponse" },
    examples: { invalid: { value: { ok: false, error: "id is required" } } },
  },
};

export const settingsAgentRemovalPaths = {
  "/api/settings/agents/remove": {
    get: {
      tags: ["Settings"],
      summary: "Preview agent removal impact",
      description:
        "Returns the configured references that would be affected before an " +
        "agent is removed through DELETE /api/settings/agents.",
      operationId: "getAgentRemovalImpact",
      parameters: [
        {
          name: "id",
          in: "query" as const,
          required: true,
          schema: { type: "string", minLength: 1 },
          description: "Configured agent identifier.",
        },
      ],
      responses: {
        "200": {
          description: "Agent removal impact",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    additionalProperties: true,
                    description: "Pools and action mappings that reference the agent.",
                  },
                },
              },
              examples: {
                success: {
                  value: {
                    ok: true,
                    data: {
                      agentId: "codex",
                      poolReferences: ["implementation"],
                      actionReferences: ["work_sdlc.implementation"],
                    },
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Missing or invalid agent id",
          content: jsonError,
        },
      },
    },
  },
} as const;
