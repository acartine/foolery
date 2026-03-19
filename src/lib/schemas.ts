import { z } from "zod/v4";

// ── Beat schemas ────────────────────────────────────────────

/** Open string type — default "work" for knots compatibility. */
export const beatTypeSchema = z.string().default("work");

/** Workflow state — open string, e.g. "ready_for_implementation", "shipped". */
export const beatStateSchema = z.string();

export const workflowModeSchema = z.enum([
  "granular_autonomous",
  "coarse_human_gated",
]);

export const beatPrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const invariantKindSchema = z.enum(["Scope", "State"]);

export const invariantSchema = z.object({
  kind: invariantKindSchema,
  condition: z.string().trim().min(1),
});

export const createBeatSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: beatTypeSchema,
  priority: beatPrioritySchema.default(2),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
  due: z.string().optional(),
  acceptance: z.string().optional(),
  notes: z.string().optional(),
  parent: z.string().optional(),
  estimate: z.number().int().positive().optional(),
  invariants: z.array(invariantSchema).optional(),
  profileId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
});

export const updateBeatSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  state: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  priority: beatPrioritySchema.optional(),
  parent: z.string().optional(),
  labels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  due: z.string().optional(),
  acceptance: z.string().optional(),
  notes: z.string().optional(),
  estimate: z.number().int().positive().optional(),
  addInvariants: z.array(invariantSchema).optional(),
  removeInvariants: z.array(invariantSchema).optional(),
  clearInvariants: z.boolean().optional(),
});

export const closeBeatSchema = z.object({
  reason: z.string().optional(),
});

export const cascadeCloseSchema = z.object({
  confirmed: z.boolean().default(false),
  reason: z.string().optional(),
});

export const queryBeatSchema = z.object({
  expression: z.string().min(1, "Query expression is required"),
  limit: z.number().int().positive().default(50),
  sort: z.string().optional(),
});

export const addDepSchema = z.object({
  blocks: z.string().min(1, "Blocked issue ID is required"),
});

export const addRepoSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

export const removeRepoSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

export type CreateBeatInput = z.infer<typeof createBeatSchema>;
export type UpdateBeatInput = z.infer<typeof updateBeatSchema>;
export type CloseBeatInput = z.infer<typeof closeBeatSchema>;
export type CascadeCloseInput = z.infer<typeof cascadeCloseSchema>;
export type QueryBeatInput = z.infer<typeof queryBeatSchema>;
export type AddDepInput = z.infer<typeof addDepSchema>;
export type AddRepoInput = z.infer<typeof addRepoSchema>;
export type RemoveRepoInput = z.infer<typeof removeRepoSchema>;

// ── Settings schemas ────────────────────────────────────────

// A single registered agent
export const registeredAgentSchema = z.object({
  command: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  flavor: z.string().optional(),
  version: z.string().optional(),
  label: z.string().optional(),
});

// Map of agent-id -> agent config
export const agentsMapSchema = z
  .record(z.string(), registeredAgentSchema)
  .default({});

// Which agent to use for each agentic action
export const actionAgentMappingsSchema = z
  .object({
    take: z.string().default(""),
    scene: z.string().default(""),
    breakdown: z.string().default(""),
  })
  .default({
    take: "",
    scene: "",
    breakdown: "",
  });

// Backend selection (internal, non-user-facing)
export const backendSettingsSchema = z
  .object({
    /** Backend implementation to use: "auto" (default), "cli", "stub", "beads", or "knots". */
    type: z.enum(["auto", "cli", "stub", "beads", "knots"]).default("auto"),
  })
  .default({ type: "auto" });

// User-facing defaults for beat creation
export const defaultsSettingsSchema = z
  .object({
    /** Default workflow profile ID for new beats (empty = "autopilot" fallback). */
    profileId: z.string().default(""),
  })
  .default({ profileId: "" });

// Agent dispatch mode: "basic" uses simple per-action mappings,
// "advanced" uses weighted per-step agent pools.
export const dispatchModeSchema = z
  .enum(["basic", "advanced"])
  .default("basic");

// Agent pool entry: weighted agent selection
export const poolEntrySchema = z.object({
  /** ID of a registered agent. */
  agentId: z.string().min(1),
  /** Relative weight for selection probability. */
  weight: z.number().min(0).default(1),
});

// Pools keyed by workflow step
export const poolsSettingsSchema = z
  .object({
    planning: z.array(poolEntrySchema).default([]),
    plan_review: z.array(poolEntrySchema).default([]),
    implementation: z.array(poolEntrySchema).default([]),
    implementation_review: z.array(poolEntrySchema).default([]),
    shipment: z.array(poolEntrySchema).default([]),
    shipment_review: z.array(poolEntrySchema).default([]),
  })
  .default({
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
  });

export const foolerySettingsSchema = z.object({
  agents: agentsMapSchema,
  actions: actionAgentMappingsSchema,
  backend: backendSettingsSchema,
  defaults: defaultsSettingsSchema,
  pools: poolsSettingsSchema,
  dispatchMode: dispatchModeSchema,
  maxConcurrentSessions: z.number().int().min(1).max(20).default(5),
});

export type FoolerySettings = z.infer<typeof foolerySettingsSchema>;
export type RegisteredAgentConfig = z.infer<typeof registeredAgentSchema>;
export type ActionAgentMappings = z.infer<typeof actionAgentMappingsSchema>;
export type BackendSettings = z.infer<typeof backendSettingsSchema>;
export type DefaultsSettings = z.infer<typeof defaultsSettingsSchema>;
export type PoolEntry = z.infer<typeof poolEntrySchema>;
export type PoolsSettings = z.infer<typeof poolsSettingsSchema>;
export type DispatchMode = z.infer<typeof dispatchModeSchema>;
