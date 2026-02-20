import { z } from "zod/v4";

export const beadTypeSchema = z.enum([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "merge-request",
  "molecule",
  "gate",
]);

export const beadStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
]);

export const beadPrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const createBeadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: beadTypeSchema.default("task"),
  priority: beadPrioritySchema.default(2),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
  due: z.string().optional(),
  acceptance: z.string().optional(),
  notes: z.string().optional(),
  parent: z.string().optional(),
  estimate: z.number().int().positive().optional(),
});

export const updateBeadSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: beadTypeSchema.optional(),
  status: beadStatusSchema.optional(),
  priority: beadPrioritySchema.optional(),
  parent: z.string().optional(),
  labels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  due: z.string().optional(),
  acceptance: z.string().optional(),
  notes: z.string().optional(),
  estimate: z.number().int().positive().optional(),
});

export const closeBeadSchema = z.object({
  reason: z.string().optional(),
});

export const queryBeadSchema = z.object({
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

export type CreateBeadInput = z.infer<typeof createBeadSchema>;
export type UpdateBeadInput = z.infer<typeof updateBeadSchema>;
export type CloseBeadInput = z.infer<typeof closeBeadSchema>;
export type QueryBeadInput = z.infer<typeof queryBeadSchema>;
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
  })
  .default({ enabled: false, agent: "" });

export const foolerySettingsSchema = z.object({
  agent: agentSettingsSchema.default({ command: "claude" }),
  agents: agentsMapSchema,
  actions: actionAgentMappingsSchema,
  verification: verificationSettingsSchema,
});

export type FoolerySettings = z.infer<typeof foolerySettingsSchema>;
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type RegisteredAgentConfig = z.infer<typeof registeredAgentSchema>;
export type ActionAgentMappings = z.infer<typeof actionAgentMappingsSchema>;
export type VerificationSettings = z.infer<typeof verificationSettingsSchema>;
