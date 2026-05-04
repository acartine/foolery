/**
 * OpenAPI 3.1.0 reusable component schemas for the Foolery API.
 */

import { extendedComponentSchemas } from "./schemas-extended";
import { planComponentSchemas } from "./schemas-plans";
import { approvalComponentSchemas } from "./schemas-approvals";

const coreSchemas = {
  Beat: {
    type: "object",
    required: ["id", "title", "type", "state", "priority", "labels", "created", "updated"],
    properties: {
      id: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      title: { type: "string" },
      description: { type: "string" },
      notes: { type: "string" },
      acceptance: { type: "string" },
      type: { type: "string", examples: ["work", "task", "bug", "feature", "epic", "chore", "molecule", "gate"] },
      state: { type: "string", examples: ["ready_for_implementation", "shipped", "closed"] },
      workflowId: { type: "string" },
      workflowMode: { type: "string", enum: ["granular_autonomous", "coarse_human_gated"] },
      profileId: { type: "string" },
      nextActionState: { type: "string" },
      nextActionOwnerKind: { type: "string", enum: ["agent", "human", "none"] },
      requiresHumanAction: { type: "boolean" },
      isAgentClaimable: { type: "boolean" },
      priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
      labels: { type: "array", items: { type: "string" } },
      assignee: { type: "string" },
      owner: { type: "string" },
      parent: { type: "string" },
      due: { type: "string", format: "date" },
      estimate: { type: "integer", minimum: 1 },
      created: { type: "string", format: "date-time" },
      updated: { type: "string", format: "date-time" },
      closed: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
    },
  },

  BeatDependency: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      type: { type: "string" },
      source: { type: "string" },
      target: { type: "string" },
      dependency_type: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      state: { type: "string" },
      priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
      issue_type: { type: "string" },
      owner: { type: "string" },
    },
  },

  WaveBeat: {
    type: "object",
    required: ["id", "title", "type", "state", "priority", "labels", "blockedBy", "readiness", "readinessReason"],
    properties: {
      id: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      title: { type: "string" },
      type: { type: "string" },
      state: { type: "string" },
      priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
      labels: { type: "array", items: { type: "string" } },
      blockedBy: { type: "array", items: { type: "string" } },
      readiness: { type: "string", enum: ["runnable", "in_progress", "blocked", "humanAction", "gate", "unschedulable"] },
      readinessReason: { type: "string" },
      waveLevel: { type: "integer" },
    },
  },

  Wave: {
    type: "object",
    required: ["level", "beats"],
    properties: {
      level: { type: "integer" },
      beats: { type: "array", items: { $ref: "#/components/schemas/WaveBeat" } },
      gate: { $ref: "#/components/schemas/WaveBeat" },
    },
  },

  WaveSummary: {
    type: "object",
    required: ["total", "runnable", "inProgress", "blocked", "humanAction", "gates", "unschedulable"],
    properties: {
      total: { type: "integer" },
      runnable: { type: "integer" },
      inProgress: { type: "integer" },
      blocked: { type: "integer" },
      humanAction: { type: "integer" },
      gates: { type: "integer" },
      unschedulable: { type: "integer" },
    },
  },

  WaveRecommendation: {
    type: "object",
    required: ["beatId", "title", "waveLevel", "reason"],
    properties: {
      beatId: { type: "string" },
      title: { type: "string" },
      waveLevel: { type: "integer" },
      reason: { type: "string" },
    },
  },

  WavePlan: {
    type: "object",
    required: ["waves", "unschedulable", "summary", "runnableQueue", "computedAt"],
    properties: {
      waves: { type: "array", items: { $ref: "#/components/schemas/Wave" } },
      unschedulable: { type: "array", items: { $ref: "#/components/schemas/WaveBeat" } },
      summary: { $ref: "#/components/schemas/WaveSummary" },
      recommendation: { $ref: "#/components/schemas/WaveRecommendation" },
      runnableQueue: { type: "array", items: { $ref: "#/components/schemas/WaveRecommendation" } },
      computedAt: { type: "string", format: "date-time" },
    },
  },

  TerminalSession: {
    type: "object",
    required: ["id", "beatId", "beatTitle", "status", "startedAt"],
    properties: {
      id: { type: "string" },
      beatId: { type: "string" },
      beatTitle: { type: "string" },
      beatIds: { type: "array", items: { type: "string" } },
      repoPath: { type: "string" },
      agentName: { type: "string" },
      agentModel: { type: "string" },
      agentVersion: { type: "string" },
      agentCommand: { type: "string" },
      status: { type: "string", enum: ["idle", "running", "completed", "error", "aborted"] },
      startedAt: { type: "string", format: "date-time" },
      exitCode: { type: "integer" },
      pendingApprovals: {
        type: "array",
        description:
          "Compatibility view: approval escalations attached to this " +
          "session. Same records also appear in GET /api/approvals.",
        items: { $ref: "#/components/schemas/ApprovalEscalation" },
      },
    },
  },

  TerminalEvent: {
    type: "object",
    required: ["type", "data", "timestamp"],
    properties: {
      type: {
        type: "string",
        enum: [
          "stdout",
          "stderr",
          "exit",
          "stream_end",
          "agent_switch",
          "beat_state_observed",
        ],
      },
      data: { type: "string" },
      timestamp: { type: "number" },
    },
  },

  OrchestrationEvent: {
    type: "object",
    required: ["type", "data", "timestamp"],
    properties: {
      type: { type: "string", enum: ["log", "plan", "status", "error", "exit"] },
      data: { oneOf: [{ type: "string" }, { $ref: "#/components/schemas/OrchestrationPlan" }] },
      timestamp: { type: "number" },
    },
  },

  OrchestrationPlan: {
    type: "object",
    required: ["summary", "waves", "unassignedBeatIds", "assumptions"],
    properties: {
      summary: { type: "string" },
      waves: {
        type: "array",
        items: {
          type: "object",
          required: ["waveIndex", "name", "objective", "agents", "beats"],
          properties: {
            waveIndex: { type: "integer" },
            name: { type: "string" },
            objective: { type: "string" },
            agents: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "count"],
                properties: {
                  role: { type: "string" },
                  count: { type: "integer" },
                  specialty: { type: "string" },
                },
              },
            },
            beats: {
              type: "array",
              items: {
                $ref: "#/components/schemas/OrchestrationWaveBeat",
              },
            },
            steps: {
              type: "array",
              items: {
                $ref: "#/components/schemas/PlanStep",
              },
            },
            notes: { type: "string" },
          },
        },
      },
      unassignedBeatIds: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
    },
  },

  OrchestrationSession: {
    type: "object",
    required: ["id", "repoPath", "status", "startedAt"],
    properties: {
      id: { type: "string" },
      repoPath: { type: "string" },
      status: { type: "string", enum: ["running", "completed", "error", "aborted"] },
      startedAt: { type: "string", format: "date-time" },
      objective: { type: "string" },
      completedAt: { type: "string", format: "date-time" },
      error: { type: "string" },
      plan: { $ref: "#/components/schemas/OrchestrationPlan" },
    },
  },

  AppliedWaveResult: {
    type: "object",
    required: ["waveIndex", "waveId", "waveSlug", "waveTitle", "childCount", "children"],
    properties: {
      waveIndex: { type: "integer" },
      waveId: { type: "string" },
      waveSlug: { type: "string" },
      waveTitle: { type: "string" },
      childCount: { type: "integer" },
      children: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
          },
        },
      },
    },
  },

  RegisteredRepo: {
    type: "object",
    required: ["path", "name", "addedAt"],
    properties: {
      path: { type: "string" },
      name: { type: "string" },
      addedAt: { type: "string", format: "date-time" },
      memoryManagerType: { type: "string" },
    },
  },

  DirEntry: {
    type: "object",
    required: ["name", "path", "isCompatible"],
    properties: {
      name: { type: "string" },
      path: { type: "string" },
      memoryManagerType: { type: "string" },
      isCompatible: { type: "boolean" },
    },
  },

  RegisteredAgent: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      agent_type: { type: "string" },
      vendor: { type: "string" },
      provider: { type: "string" },
      agent_name: { type: "string" },
      lease_model: { type: "string" },
      model: { type: "string" },
      flavor: { type: "string" },
      version: { type: "string" },
      approvalMode: {
        type: "string",
        enum: ["bypass", "prompt"],
      },
      label: { type: "string" },
      agentId: { type: "string" },
    },
  },

  ScannedAgentOption: {
    type: "object",
    required: ["id", "label"],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      flavor: { type: "string" },
      version: { type: "string" },
      modelId: { type: "string" },
    },
  },

  ScannedAgent: {
    type: "object",
    required: ["id", "command", "path", "installed"],
    properties: {
      id: { type: "string" },
      command: { type: "string" },
      path: { type: "string" },
      installed: { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      flavor: { type: "string" },
      version: { type: "string" },
      modelId: { type: "string" },
      options: {
        type: "array",
        items: { $ref: "#/components/schemas/ScannedAgentOption" },
      },
      selectedOptionId: { type: "string" },
    },
  },

  FoolerySettings: {
    type: "object",
    properties: {
      agents: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            command: { type: "string" },
            model: { type: "string" },
            version: { type: "string" },
            label: { type: "string" },
          },
        },
      },
      actions: {
        type: "object",
        properties: {
          take: { type: "string" },
          scene: { type: "string" },
          scopeRefinement: { type: "string" },
          staleGrooming: { type: "string" },
        },
      },
      backend: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["auto", "cli", "stub", "beads", "knots"] },
        },
      },
      defaults: {
        type: "object",
        properties: {
          profileId: { type: "string" },
          interactiveSessionTimeoutMinutes: {
            type: "integer",
            minimum: 1,
            maximum: 240,
            default: 10,
          },
        },
      },
      scopeRefinement: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          prompt: { type: "string" },
        },
      },
      pools: {
        type: "object",
        properties: {
          orchestration: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          planning: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          plan_review: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          implementation: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          implementation_review: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          shipment: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          shipment_review: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          scope_refinement: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
          stale_grooming: { type: "array", items: { $ref: "#/components/schemas/PoolEntry" } },
        },
      },
      dispatchMode: { type: "string", enum: ["basic", "advanced"] },
      maxClaimsPerQueueType: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
  },

  PoolEntry: {
    type: "object",
    required: ["agentId", "weight"],
    properties: {
      agentId: { type: "string" },
      weight: { type: "number", minimum: 0 },
    },
  },

} as const;

export const componentSchemas = {
  ...coreSchemas,
  ...planComponentSchemas,
  ...extendedComponentSchemas,
  ...approvalComponentSchemas,
} as const;
