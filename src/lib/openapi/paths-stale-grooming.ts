export const staleGroomingPaths = {
  "/api/beats/stale-grooming": {
    get: {
      tags: ["Stale grooming"],
      summary: "List stale beats",
      description:
        "Returns beats older than the stale threshold, ordered by last-updated "
        + "age descending.",
      operationId: "listStaleBeats",
      parameters: [
        { name: "_repo", in: "query", schema: { type: "string" } },
        { name: "scope", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer" } },
        { name: "ageDays", in: "query", schema: { type: "integer" } },
      ],
      responses: {
        "200": {
          description: "Stale beat list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      staleBeats: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                      count: { type: "integer" },
                      ageDays: { type: "integer" },
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

  "/api/beats/stale-grooming/options": {
    get: {
      tags: ["Stale grooming"],
      summary: "List stale grooming model options",
      operationId: "listStaleGroomingOptions",
      responses: {
        "200": {
          description: "Configured model options and dispatch default",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },

  "/api/beats/stale-grooming/reviews": {
    get: {
      tags: ["Stale grooming"],
      summary: "List stale grooming review records",
      operationId: "listStaleGroomingReviews",
      parameters: [
        { name: "status", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Review records",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    post: {
      tags: ["Stale grooming"],
      summary: "Enqueue stale grooming reviews",
      description:
        "Enqueues explicit review targets, or `{ mode: \"oldest\", limit: 5 }` "
        + "to review the oldest stale beats.",
      operationId: "enqueueStaleGroomingReviews",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                agentId: { type: "string" },
                mode: { type: "string", enum: ["oldest"] },
                limit: { type: "integer", minimum: 1, maximum: 50 },
                _repo: { type: "string" },
                scope: { type: "string" },
                ageDays: { type: "integer" },
                targets: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["beatId"],
                    properties: {
                      beatId: { type: "string" },
                      repoPath: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Queued stale grooming jobs",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },

  "/api/beats/stale-grooming/status": {
    get: {
      tags: ["Stale grooming"],
      summary: "Get stale grooming queue and worker status",
      operationId: "getStaleGroomingStatus",
      responses: {
        "200": {
          description: "Queue, worker, and review status",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },
} as const;
