/**
 * OpenAPI path definitions for wave planning endpoints.
 */

export const wavesPaths = {
  "/api/waves": {
    get: {
      tags: ["Waves"],
      summary: "Get wave execution plan",
      operationId: "getWavePlan",
      parameters: [
        { name: "_repo", in: "query", schema: { type: "string" }, description: "Repository path" },
      ],
      responses: {
        "200": {
          description: "Wave plan with scheduling and recommendations",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WavePlan" },
            },
          },
        },
        "500": {
          description: "Server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
        "503": {
          description: "Backend degraded",
        },
      },
    },
  },
} as const;
