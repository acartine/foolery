/**
 * OpenAPI schemas for persisted execution plans.
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

  PlanStep: {
    type: "object",
    required: ["stepIndex", "beatIds"],
    properties: {
      stepIndex: { type: "integer", minimum: 1 },
      beatIds: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
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

  PlanArtifact: {
    type: "object",
    required: ["id", "type", "state", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["execution_plan"] },
      state: { type: "string" },
      workflowId: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },

  PlanDocument: {
    type: "object",
    required: [
      "repoPath",
      "beatIds",
      "summary",
      "waves",
      "unassignedBeatIds",
      "assumptions",
    ],
    properties: {
      repoPath: { type: "string" },
      beatIds: { type: "array", items: { type: "string" } },
      objective: { type: "string" },
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

  PlanBeatProgress: {
    type: "object",
    required: ["beatId", "state", "satisfied"],
    properties: {
      beatId: { type: "string" },
      title: { type: "string" },
      state: { type: "string" },
      satisfied: { type: "boolean" },
    },
  },

  PlanStepProgress: {
    type: "object",
    required: [
      "waveIndex",
      "stepIndex",
      "beatIds",
      "complete",
      "satisfiedBeatIds",
      "remainingBeatIds",
    ],
    properties: {
      waveIndex: { type: "integer", minimum: 1 },
      stepIndex: { type: "integer", minimum: 1 },
      beatIds: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
      complete: { type: "boolean" },
      satisfiedBeatIds: { type: "array", items: { type: "string" } },
      remainingBeatIds: { type: "array", items: { type: "string" } },
    },
  },

  PlanWaveProgress: {
    type: "object",
    required: ["waveIndex", "complete", "steps"],
    properties: {
      waveIndex: { type: "integer", minimum: 1 },
      complete: { type: "boolean" },
      steps: {
        type: "array",
        items: { $ref: "#/components/schemas/PlanStepProgress" },
      },
    },
  },

  NextPlanStep: {
    type: "object",
    required: ["waveIndex", "stepIndex", "beatIds"],
    properties: {
      waveIndex: { type: "integer", minimum: 1 },
      stepIndex: { type: "integer", minimum: 1 },
      beatIds: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
  },

  PlanProgress: {
    type: "object",
    required: [
      "generatedAt",
      "completionRule",
      "beatStates",
      "satisfiedBeatIds",
      "remainingBeatIds",
      "nextStep",
      "waves",
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      completionRule: { type: "string", enum: ["shipped"] },
      beatStates: {
        type: "array",
        items: { $ref: "#/components/schemas/PlanBeatProgress" },
      },
      satisfiedBeatIds: { type: "array", items: { type: "string" } },
      remainingBeatIds: { type: "array", items: { type: "string" } },
      nextStep: {
        oneOf: [
          { $ref: "#/components/schemas/NextPlanStep" },
          { type: "null" },
        ],
      },
      waves: {
        type: "array",
        items: { $ref: "#/components/schemas/PlanWaveProgress" },
      },
    },
  },

  PlanLineage: {
    type: "object",
    required: ["replacedByPlanIds"],
    properties: {
      replacesPlanId: { type: "string" },
      replacedByPlanIds: {
        type: "array",
        items: { type: "string" },
      },
    },
  },

  PersistedPlan: {
    type: "object",
    required: ["artifact", "plan", "progress", "lineage", "skillPrompt"],
    properties: {
      artifact: { $ref: "#/components/schemas/PlanArtifact" },
      plan: { $ref: "#/components/schemas/PlanDocument" },
      progress: { $ref: "#/components/schemas/PlanProgress" },
      lineage: { $ref: "#/components/schemas/PlanLineage" },
      skillPrompt: { type: "string" },
    },
  },

  PlanSummary: {
    type: "object",
    required: ["artifact", "plan"],
    properties: {
      artifact: { $ref: "#/components/schemas/PlanArtifact" },
      plan: {
        type: "object",
        required: ["repoPath", "beatIds", "summary"],
        properties: {
          repoPath: { type: "string" },
          beatIds: { type: "array", items: { type: "string" } },
          objective: { type: "string" },
          summary: { type: "string" },
          mode: { type: "string", enum: ["scene", "groom"] },
          model: { type: "string" },
        },
      },
    },
  },

  CreatePlanRequest: {
    type: "object",
    required: ["repoPath", "beatIds"],
    properties: {
      repoPath: { type: "string" },
      beatIds: { type: "array", items: { type: "string" } },
      objective: { type: "string" },
      mode: { type: "string", enum: ["scene", "groom"] },
      model: { type: "string" },
      replacesPlanId: { type: "string" },
    },
  },

  CreatePlanResponse: {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        $ref: "#/components/schemas/PersistedPlan",
      },
    },
  },
} as const;
