/**
 * OpenAPI schemas for persisted execution plans and plan-driving APIs.
 */

export const planComponentSchemas = {
  OrchestrationAgentSpec: {
    type: "object",
    required: ["role", "count"],
    properties: {
      role: { type: "string" },
      count: { type: "integer" },
      specialty: { type: "string" },
    },
  },

  OrchestrationWaveBeat: {
    type: "object",
    required: ["id", "title"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
    },
  },

  OrchestrationWaveStep: {
    type: "object",
    required: ["stepIndex", "beatIds"],
    properties: {
      stepIndex: { type: "integer", minimum: 1 },
      beatIds: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
  },

  PlanStep: {
    type: "object",
    required: [
      "id",
      "title",
      "waveIndex",
      "stepIndex",
      "beatIds",
      "status",
      "dependsOn",
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      waveIndex: { type: "integer", minimum: 1 },
      stepIndex: { type: "integer", minimum: 1 },
      beatIds: { type: "array", items: { type: "string" } },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "complete", "failed"],
      },
      dependsOn: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time" },
      failedAt: { type: "string", format: "date-time" },
      failureReason: { type: "string" },
    },
  },

  PlanWave: {
    type: "object",
    required: ["waveIndex", "name", "objective", "agents", "beats", "steps"],
    properties: {
      waveIndex: { type: "integer", minimum: 1 },
      name: { type: "string" },
      objective: { type: "string" },
      agents: {
        type: "array",
        items: { $ref: "#/components/schemas/OrchestrationAgentSpec" },
      },
      beats: {
        type: "array",
        items: { $ref: "#/components/schemas/OrchestrationWaveBeat" },
      },
      steps: {
        type: "array",
        items: { $ref: "#/components/schemas/PlanStep" },
      },
      notes: { type: "string" },
    },
  },

  PersistedPlan: {
    type: "object",
    required: [
      "id",
      "repoPath",
      "createdAt",
      "updatedAt",
      "status",
      "summary",
      "waves",
      "unassignedBeatIds",
      "assumptions",
    ],
    properties: {
      id: { type: "string" },
      repoPath: { type: "string" },
      objective: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      status: {
        type: "string",
        enum: ["draft", "active", "complete", "aborted"],
      },
      summary: { type: "string" },
      waves: {
        type: "array",
        items: { $ref: "#/components/schemas/PlanWave" },
      },
      unassignedBeatIds: {
        type: "array",
        items: { type: "string" },
      },
      assumptions: {
        type: "array",
        items: { type: "string" },
      },
      mode: { type: "string", enum: ["scene", "groom"] },
      model: { type: "string" },
    },
  },

  CreatePlanRequest: {
    type: "object",
    required: ["repoPath"],
    properties: {
      repoPath: { type: "string" },
      objective: { type: "string" },
      mode: { type: "string", enum: ["scene", "groom"] },
      model: { type: "string" },
    },
  },

  CreatePlanResponse: {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        required: ["planId"],
        properties: {
          planId: { type: "string" },
        },
      },
    },
  },

  PlanStepStartResult: {
    type: "object",
    required: ["beats"],
    properties: {
      beats: {
        type: "array",
        items: {
          type: "object",
          required: ["beatId", "sessionId"],
          properties: {
            beatId: { type: "string" },
            sessionId: { type: "string" },
          },
        },
      },
    },
  },

  PlanStepStatusResult: {
    type: "object",
    required: ["stepId", "status"],
    properties: {
      stepId: { type: "string" },
      status: { type: "string", enum: ["complete", "failed"] },
    },
  },
} as const;
