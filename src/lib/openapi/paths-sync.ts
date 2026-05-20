export const syncPaths = {
  "/api/sync/beats": {
    get: {
      tags: ["Sync"],
      summary: "Read beats sync state",
      operationId: "getBeatsSyncState",
      responses: {
        "200": {
          description: "Current beats sync state",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BeatsSyncState" },
            },
          },
        },
        "500": {
          description: "Server error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    post: {
      tags: ["Sync"],
      summary: "Read beats sync state and start one sync job if idle",
      operationId: "triggerBeatsSync",
      responses: {
        "200": {
          description: "Pre-trigger beats sync state",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BeatsSyncState" },
            },
          },
        },
        "500": {
          description: "Server error",
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
