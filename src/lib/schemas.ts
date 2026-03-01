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

export const agentSettingsSchema = z.object({
  command: z.string().min(1).default("claude"),
});

// A single registered agent
export const registeredAgentSchema = z.object({
  command: z.string().min(1),
  model: z.string().optional(),
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
    direct: z.string().default(""),
    breakdown: z.string().default(""),
  })
  .default({
    take: "",
    scene: "",
    direct: "",
    breakdown: "",
  });

// Auto-verification settings
export const verificationSettingsSchema = z
  .object({
    /** Whether auto-verification is enabled after code-producing actions. */
    enabled: z.boolean().default(false),
    /** Agent ID to use for verification (empty string = use default agent). */
    agent: z.string().default(""),
    /** Maximum automatic retry attempts before stopping. 0 = no auto-retry. */
    maxRetries: z.number().int().min(0).default(3),
  })
  .default({ enabled: false, agent: "", maxRetries: 3 });

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

export const foolerySettingsSchema = z.object({
  agent: agentSettingsSchema.default({ command: "claude" }),
  agents: agentsMapSchema,
  actions: actionAgentMappingsSchema,
  verification: verificationSettingsSchema,
  backend: backendSettingsSchema,
  defaults: defaultsSettingsSchema,
});

export type FoolerySettings = z.infer<typeof foolerySettingsSchema>;
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type RegisteredAgentConfig = z.infer<typeof registeredAgentSchema>;
export type ActionAgentMappings = z.infer<typeof actionAgentMappingsSchema>;
export type VerificationSettings = z.infer<typeof verificationSettingsSchema>;
export type BackendSettings = z.infer<typeof backendSettingsSchema>;
export type DefaultsSettings = z.infer<typeof defaultsSettingsSchema>;

// ── Deprecated re-exports (to be removed in cleanup pass) ───

/** @deprecated Use beatTypeSchema */
export const beadTypeSchema = beatTypeSchema;
/** @deprecated Use beatStateSchema */
export const beadStatusSchema = beatStateSchema;
/** @deprecated Use beatPrioritySchema */
export const beadPrioritySchema = beatPrioritySchema;
/** @deprecated Use createBeatSchema */
export const createBeadSchema = createBeatSchema;
/** @deprecated Use updateBeatSchema */
export const updateBeadSchema = updateBeatSchema;
/** @deprecated Use closeBeatSchema */
export const closeBeadSchema = closeBeatSchema;
/** @deprecated Use queryBeatSchema */
export const queryBeadSchema = queryBeatSchema;
/** @deprecated Use CreateBeatInput */
export type CreateBeadInput = CreateBeatInput;
/** @deprecated Use UpdateBeatInput */
export type UpdateBeadInput = UpdateBeatInput;
/** @deprecated Use CloseBeatInput */
export type CloseBeadInput = CloseBeatInput;
/** @deprecated Use QueryBeatInput */
export type QueryBeadInput = QueryBeatInput;
