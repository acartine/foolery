/**
 * OpenAPI schemas for persisted execution plans.
 */

export const planComponentSchemas = {
  OrchestrationAgentSpec: {
    type: "object",
    description:
      "Suggested agent staffing for one wave of work.",
    required: ["role", "count"],
    properties: {
      role: { type: "string", description: "Suggested agent role." },
      count: {
        type: "integer",
        description: "Number of agents suggested for this role.",
      },
      specialty: {
        type: "string",
        description: "Optional specialty or focus area for the role.",
      },
    },
  },

  OrchestrationWaveBeat: {
    type: "object",
    description:
      "One beat included in a wave, represented by id and title only.",
    required: ["id", "title"],
    properties: {
      id: { type: "string", description: "Beat id." },
      title: { type: "string", description: "Beat title at plan time." },
    },
  },

  PlanStep: {
    type: "object",
    description:
      "One sequential step inside a wave. All beats in a step may be driven " +
      "in parallel.",
    required: ["stepIndex", "beatIds"],
    properties: {
      stepIndex: {
        type: "integer",
        minimum: 1,
        description: "One-based index within the wave.",
      },
      beatIds: {
        type: "array",
        description: "Beat ids that belong to this step.",
        items: { type: "string" },
      },
      notes: {
        type: "string",
        description: "Optional operator guidance for this step.",
      },
    },
  },

  PlanWave: {
    type: "object",
    description:
      "One wave in the immutable execution plan. Waves are ordered, while " +
      "steps inside a wave define finer-grained sequencing.",
    required: ["waveIndex", "name", "objective", "agents", "beats", "steps"],
    properties: {
      waveIndex: {
        type: "integer",
        minimum: 1,
        description: "One-based wave index.",
      },
      name: {
        type: "string",
        description: "Short label for the wave.",
      },
      objective: {
        type: "string",
        description: "What this wave is meant to accomplish.",
      },
      agents: {
        type: "array",
        description: "Suggested agent staffing for the wave.",
        items: { $ref: "#/components/schemas/OrchestrationAgentSpec" },
      },
      beats: {
        type: "array",
        description: "Beats assigned to the wave.",
        items: { $ref: "#/components/schemas/OrchestrationWaveBeat" },
      },
      steps: {
        type: "array",
        description: "Sequential steps inside this wave.",
        items: { $ref: "#/components/schemas/PlanStep" },
      },
      notes: {
        type: "string",
        description: "Optional wave-level guidance.",
      },
    },
  },

  PlanArtifact: {
    type: "object",
    description:
      "Metadata for the persisted `execution_plan` knot that stores the plan.",
    required: ["id", "type", "state", "createdAt", "updatedAt"],
    properties: {
      id: {
        type: "string",
        description:
          "Stable plan identifier. Persist this value and reuse it on later reads.",
      },
      type: {
        type: "string",
        enum: ["execution_plan"],
        description: "Stored knot type for persisted plans.",
      },
      state: {
        type: "string",
        description: "Current state of the underlying plan knot.",
      },
      workflowId: {
        type: "string",
        description: "Workflow id attached to the underlying plan knot.",
      },
      createdAt: {
        type: "string",
        format: "date-time",
        description: "When the persisted plan knot was created.",
      },
      updatedAt: {
        type: "string",
        format: "date-time",
        description: "When the persisted plan knot was last updated.",
      },
    },
  },

  PlanDocument: {
    type: "object",
    description:
      "Immutable execution-plan document. This structure does not change as " +
      "work advances; only the derived `progress` view changes over time.",
    required: [
      "repoPath",
      "beatIds",
      "summary",
      "waves",
      "unassignedBeatIds",
      "assumptions",
    ],
    properties: {
      repoPath: {
        type: "string",
        description: "Repository path the plan applies to.",
      },
      beatIds: {
        type: "array",
        description: "All beat ids selected for planning.",
        items: { type: "string" },
      },
      objective: {
        type: "string",
        description: "Optional free-form planning objective from the caller.",
      },
      summary: {
        type: "string",
        description: "Planner-authored summary of the full plan.",
      },
      waves: {
        type: "array",
        description: "Ordered waves in the immutable plan.",
        items: { $ref: "#/components/schemas/PlanWave" },
      },
      unassignedBeatIds: {
        type: "array",
        description:
          "Beat ids the planner could not confidently assign to a wave.",
        items: { type: "string" },
      },
      assumptions: {
        type: "array",
        description:
          "Assumptions the planner made while producing the plan.",
        items: { type: "string" },
      },
      mode: {
        type: "string",
        enum: ["scene", "groom"],
        description: "Optional planning mode used during generation.",
      },
      model: {
        type: "string",
        description: "Optional planner model used during generation.",
      },
    },
  },

  PlanBeatProgress: {
    type: "object",
    description:
      "Live progress snapshot for one beat referenced by the plan.",
    required: ["beatId", "state", "satisfied"],
    properties: {
      beatId: { type: "string", description: "Beat id." },
      title: {
        type: "string",
        description: "Best-effort beat title at read time.",
      },
      state: {
        type: "string",
        description: "Current live beat state in Knots.",
      },
      satisfied: {
        type: "boolean",
        description:
          "Whether the beat satisfies the plan's completion rule. Currently " +
          "only `state === shipped` counts as satisfied.",
      },
    },
  },

  PlanStepProgress: {
    type: "object",
    description:
      "Derived progress for one plan step.",
    required: [
      "waveIndex",
      "stepIndex",
      "beatIds",
      "complete",
      "satisfiedBeatIds",
      "remainingBeatIds",
    ],
    properties: {
      waveIndex: { type: "integer", minimum: 1, description: "Wave index." },
      stepIndex: {
        type: "integer",
        minimum: 1,
        description: "Step index within the wave.",
      },
      beatIds: {
        type: "array",
        description: "Beats included in the step.",
        items: { type: "string" },
      },
      notes: {
        type: "string",
        description: "Optional operator guidance copied from the plan.",
      },
      complete: {
        type: "boolean",
        description: "True when every beat in the step is satisfied.",
      },
      satisfiedBeatIds: {
        type: "array",
        description: "Subset of `beatIds` already satisfied.",
        items: { type: "string" },
      },
      remainingBeatIds: {
        type: "array",
        description: "Subset of `beatIds` still incomplete.",
        items: { type: "string" },
      },
    },
  },

  PlanWaveProgress: {
    type: "object",
    description:
      "Derived progress for one wave.",
    required: ["waveIndex", "complete", "steps"],
    properties: {
      waveIndex: { type: "integer", minimum: 1, description: "Wave index." },
      complete: {
        type: "boolean",
        description: "True when every step in the wave is complete.",
      },
      steps: {
        type: "array",
        description: "Per-step progress inside the wave.",
        items: { $ref: "#/components/schemas/PlanStepProgress" },
      },
    },
  },

  NextPlanStep: {
    type: "object",
    description:
      "The next incomplete step in wave order. This is the primary field a " +
      "consumer should use to decide what to drive next.",
    required: ["waveIndex", "stepIndex", "beatIds"],
    properties: {
      waveIndex: { type: "integer", minimum: 1, description: "Wave index." },
      stepIndex: {
        type: "integer",
        minimum: 1,
        description: "Step index within the wave.",
      },
      beatIds: {
        type: "array",
        description: "Beats to drive next.",
        items: { type: "string" },
      },
      notes: {
        type: "string",
        description: "Optional operator guidance for the step.",
      },
    },
  },

  PlanProgress: {
    type: "object",
    description:
      "Live derived progress view for an immutable plan.",
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
      generatedAt: {
        type: "string",
        format: "date-time",
        description: "When this progress snapshot was generated.",
      },
      completionRule: {
        type: "string",
        enum: ["shipped"],
        description:
          "Rule used to decide whether a beat is complete. Currently always " +
          "`shipped`.",
      },
      beatStates: {
        type: "array",
        description: "Live per-beat progress across the entire plan.",
        items: { $ref: "#/components/schemas/PlanBeatProgress" },
      },
      satisfiedBeatIds: {
        type: "array",
        description: "Beat ids already satisfying the completion rule.",
        items: { type: "string" },
      },
      remainingBeatIds: {
        type: "array",
        description: "Beat ids that still need to reach `shipped`.",
        items: { type: "string" },
      },
      nextStep: {
        description:
          "Next incomplete step in wave order, or null when the full plan is complete.",
        oneOf: [
          { $ref: "#/components/schemas/NextPlanStep" },
          { type: "null" },
        ],
      },
      waves: {
        type: "array",
        description: "Per-wave derived progress.",
        items: { $ref: "#/components/schemas/PlanWaveProgress" },
      },
    },
  },

  PlanLineage: {
    type: "object",
    description:
      "Revision relationships between plans.",
    required: ["replacedByPlanIds"],
    properties: {
      replacesPlanId: {
        type: "string",
        description: "Prior plan id superseded by this plan, if any.",
      },
      replacedByPlanIds: {
        type: "array",
        description: "Newer plans that supersede this plan.",
        items: { type: "string" },
      },
    },
  },

  PersistedPlan: {
    type: "object",
    description:
      "Full execution-plan record returned by create and get operations.",
    required: ["artifact", "plan", "progress", "lineage", "skillPrompt"],
    properties: {
      artifact: { $ref: "#/components/schemas/PlanArtifact" },
      plan: { $ref: "#/components/schemas/PlanDocument" },
      progress: { $ref: "#/components/schemas/PlanProgress" },
      lineage: { $ref: "#/components/schemas/PlanLineage" },
      skillPrompt: {
        type: "string",
        description:
          "Generated operator prompt describing how to consume the plan safely.",
      },
    },
  },

  PlanSummary: {
    type: "object",
    description:
      "Condensed plan record returned by list operations.",
    required: ["artifact", "plan"],
    properties: {
      artifact: { $ref: "#/components/schemas/PlanArtifact" },
      plan: {
        type: "object",
        required: ["repoPath", "beatIds", "summary"],
        properties: {
          repoPath: { type: "string", description: "Repository path." },
          beatIds: {
            type: "array",
            description: "Beat ids covered by the plan.",
            items: { type: "string" },
          },
          objective: {
            type: "string",
            description: "Optional planning objective.",
          },
          summary: {
            type: "string",
            description: "Planner-authored summary.",
          },
          mode: {
            type: "string",
            enum: ["scene", "groom"],
            description: "Planning mode used during generation.",
          },
          model: {
            type: "string",
            description: "Planner model used during generation.",
          },
        },
      },
    },
  },

  CreatePlanRequest: {
    type: "object",
    description:
      "Request body used to generate and persist a new execution plan.",
    required: ["repoPath", "beatIds"],
    properties: {
      repoPath: {
        type: "string",
        description:
          "Absolute repository path. Runtime also accepts `_repo` as a " +
          "compatibility alias, but `repoPath` is preferred.",
      },
      _repo: {
        type: "string",
        description: "Compatibility alias for `repoPath`.",
      },
      beatIds: {
        type: "array",
        description:
          "Non-empty array of beat ids to include in the new plan.",
        items: { type: "string" },
      },
      objective: {
        type: "string",
        description: "Optional planning objective shown in the resulting plan.",
      },
      mode: {
        type: "string",
        enum: ["scene", "groom"],
        description: "Optional planning mode override.",
      },
      model: {
        type: "string",
        description: "Optional planner model override.",
      },
      replacesPlanId: {
        type: "string",
        description:
          "Optional prior plan id that this plan supersedes.",
      },
    },
  },

  CreatePlanResponse: {
    type: "object",
    description:
      "Successful response for plan creation.",
    required: ["data"],
    properties: {
      data: {
        $ref: "#/components/schemas/PersistedPlan",
      },
    },
  },
} as const;
