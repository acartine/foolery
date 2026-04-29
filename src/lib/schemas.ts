import { z } from "zod/v4";
import { DEFAULT_SCOPE_REFINEMENT_PROMPT } from "@/lib/scope-refinement-defaults";
import {
  DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
} from "@/lib/interactive-session-timeout";

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

export const markTerminalSchema = z.object({
  targetState: z.string().trim().min(1, "targetState is required"),
  reason: z.string().optional(),
});

/**
 * Hackish fat-finger correction: walk a beat back to an earlier queue
 * state. Server enforces queue-only + earlier-than-current invariants;
 * any misuse returns 400 with a `FOOLERY WORKFLOW CORRECTION FAILURE`
 * banner. Not a primary workflow action.
 */
export const rewindSchema = z.object({
  targetState: z.string().trim().min(1, "targetState is required"),
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
export type MarkTerminalInput = z.infer<typeof markTerminalSchema>;
export type RewindInput = z.infer<typeof rewindSchema>;
export type CascadeCloseInput = z.infer<typeof cascadeCloseSchema>;
export type QueryBeatInput = z.infer<typeof queryBeatSchema>;
export type AddDepInput = z.infer<typeof addDepSchema>;
export type AddRepoInput = z.infer<typeof addRepoSchema>;
export type RemoveRepoInput = z.infer<typeof removeRepoSchema>;

// ── Settings schemas ────────────────────────────────────────
//
// These schemas define the on-disk shape of `~/.config/foolery/settings.toml`.
// The `.describe(...)` metadata flows through to JSON Schema (via
// `z.toJSONSchema(...)`) and to the user-facing `docs/SETTINGS.md`. Treat
// this file as the authoritative spec: agents consuming
// `foolery config schema` expect the descriptions below to be truthful,
// current, and complete.

const AGENT_ID_CONVENTION
  = "Keyed by agent id using the convention `<vendor>-<model-slug>` "
  + "(e.g. `claude-claude-opus-4-7`, `codex-gpt-5-4`, "
  + "`opencode-openrouter-z-ai-glm-5`). Non-alphanumerics in the model "
  + "slug are lowercased and replaced with `-`.";

const POOL_STEP_NAMES
  = "Canonical workflow step keys: `orchestration`, `planning`, "
  + "`plan_review`, `implementation`, `implementation_review`, `shipment`, "
  + "`shipment_review`, `scope_refinement`. Additional step names are "
  + "permitted for custom workflows (pool map accepts any string key).";

const SCOPE_REFINEMENT_PLACEHOLDERS
  = "Supports `{{title}}`, `{{description}}`, `{{acceptance}}` placeholders, "
  + "substituted from the beat being refined.";

// A single registered agent.
export const registeredAgentSchema = z.object({
  command: z.string().min(1).describe(
    "Absolute path or PATH-resolvable name of the CLI to invoke "
    + "(e.g. `/Applications/cmux.app/Contents/Resources/bin/claude`, "
    + "`codex`, `opencode`).",
  ),
  agent_type: z.string().optional().describe(
    "Integration type. Typically `cli`.",
  ),
  vendor: z.string().optional().describe(
    "Short vendor key used as the agent id prefix "
    + "(e.g. `claude`, `codex`, `opencode`, `gemini`, `copilot`).",
  ),
  provider: z.string().optional().describe(
    "Display name of the provider (e.g. `Claude`, `Codex`, `OpenCode`).",
  ),
  agent_name: z.string().optional().describe(
    "Display name of the agent surfaced in the UI. Usually matches `provider`.",
  ),
  lease_model: z.string().optional().describe(
    "Lease-mapping key used to select this agent when a workflow names a "
    + "lease model (e.g. `opus/claude`, `gpt`). Optional; typical in "
    + "Advanced dispatch.",
  ),
  model: z.string().optional().describe(
    "Concrete model identifier handed to the CLI "
    + "(e.g. `claude-opus-4-7`, `gpt-5.4`, `openrouter/z-ai/glm-5`).",
  ),
  flavor: z.string().optional().describe(
    "Free-form variant tag (e.g. `mini`, `spark`). Surfaces in the "
    + "model-picker UI.",
  ),
  version: z.string().optional().describe(
    "Marketing version string (e.g. `4.7`, `5.4`). Informational.",
  ),
  approvalMode: z.enum(["bypass", "prompt"]).optional().describe(
    "Claude Code permission launch mode. Omit or set `bypass` to keep "
    + "autonomous sessions using `--dangerously-skip-permissions`; set "
    + "`prompt` on approval-test Claude agents to omit that flag.",
  ),
  label: z.string().optional().describe(
    "Human-friendly override for the agent's display label. Falls back to "
    + "`provider` or `agent_name`.",
  ),
}).describe(
  "Configuration for a single registered agent. Keyed in the parent "
  + "`agents` map by the convention `<vendor>-<model-slug>`.",
);

// Map of agent-id -> agent config.
export const agentsMapSchema = z
  .record(z.string(), registeredAgentSchema)
  .default({})
  .describe(
    `Registered agents. ${AGENT_ID_CONVENTION} Each entry is a `
    + "`registeredAgent` config; at minimum `command` is required. "
    + "Default: empty map.",
  );

// Which agent to use for each action in Basic dispatch.
export const actionAgentMappingsSchema = z
  .object({
    take: z.string().default("").describe(
      "Agent id for the \"Take!\" action (execute one beat). Empty "
      + "string means unassigned. Used only when `dispatchMode = \"basic\"`.",
    ),
    scene: z.string().default("").describe(
      "Agent id for the \"Scene!\" action (multi-beat orchestration). "
      + "Empty string means unassigned. Used only when "
      + "`dispatchMode = \"basic\"`.",
    ),
    scopeRefinement: z.string().default("").describe(
      "Agent id for the Scope Refinement action. Empty string means "
      + "unassigned. Used only when `dispatchMode = \"basic\"`.",
    ),
  })
  .default({
    take: "",
    scene: "",
    scopeRefinement: "",
  })
  .describe(
    "One-agent-per-action mapping used when `dispatchMode = \"basic\"`. "
    + "Ignored in Advanced dispatch; see `pools`.",
  );

// Backend selection (internal, non-user-facing).
export const backendSettingsSchema = z
  .object({
    type: z.enum(["auto", "cli", "stub", "beads", "knots"])
      .default("auto")
      .describe(
        "Backend implementation. `auto` detects Knots/Beads on PATH at "
        + "startup; `cli` pins to whichever is on PATH; `stub` uses the "
        + "in-memory test backend; `beads` and `knots` pin a specific "
        + "store. Default: `auto`.",
      ),
  })
  .default({ type: "auto" })
  .describe(
    "Internal backend selection. Operators usually leave this at `auto`.",
  );

// User-facing defaults for beat creation and interactive sessions.
export const defaultsSettingsSchema = z
  .object({
    profileId: z.string().default("").describe(
      "Default workflow profile id for newly created beats. Empty string "
      + "falls back to the built-in `autopilot` profile.",
    ),
    interactiveSessionTimeoutMinutes: z.number()
      .int()
      .min(MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES)
      .max(MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES)
      .default(DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES)
      .describe(
        "Inactivity timeout for interactive agent sessions, in minutes. "
        + `Range ${String(MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES)}`
        + `–${String(MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES)}. `
        + `Default: ${String(DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES)}.`,
      ),
  })
  .default({
    profileId: "",
    interactiveSessionTimeoutMinutes:
      DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  })
  .describe(
    "User-facing defaults applied at beat creation and interactive-session "
    + "management.",
  );

export const scopeRefinementSettingsSchema = z
  .object({
    prompt: z.string().default(DEFAULT_SCOPE_REFINEMENT_PROMPT).describe(
      `Template prompt for the Scope Refinement agent. ${SCOPE_REFINEMENT_PLACEHOLDERS} `
      + "Defaults to the built-in prompt shipped with Foolery; override to "
      + "taste.",
    ),
  })
  .default({
    prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT,
  })
  .describe("Scope Refinement prompt configuration.");

// Agent dispatch mode.
export const dispatchModeSchema = z
  .enum(["basic", "advanced"])
  .default("basic")
  .describe(
    "Dispatch mode. `basic`: one agent per action (see `actions`). "
    + "`advanced`: weighted pools per workflow step (see `pools`). "
    + "Default: `basic`.",
  );

// Agent pool entry: weighted agent selection.
export const poolEntrySchema = z.object({
  agentId: z.string().min(1).describe(
    "Registered agent id (key from the `agents` map, e.g. "
    + "`claude-claude-opus-4-7`).",
  ),
  weight: z.number().min(0).default(1).describe(
    "Relative selection weight within the pool. Non-negative; entries "
    + "compete proportionally. Default: 1.",
  ),
}).describe("One weighted member of a workflow-step dispatch pool.");

// Pools keyed by workflow step.
export const poolsSettingsSchema = z
  .object({
    orchestration: z.array(poolEntrySchema).default([])
      .describe("Pool for orchestration (top-level coordinator) steps."),
    planning: z.array(poolEntrySchema).default([])
      .describe("Pool for planning steps."),
    plan_review: z.array(poolEntrySchema).default([])
      .describe("Pool for plan-review gates."),
    implementation: z.array(poolEntrySchema).default([])
      .describe("Pool for implementation steps."),
    implementation_review: z.array(poolEntrySchema).default([])
      .describe("Pool for implementation-review gates."),
    shipment: z.array(poolEntrySchema).default([])
      .describe("Pool for shipment steps."),
    shipment_review: z.array(poolEntrySchema).default([])
      .describe("Pool for shipment-review gates."),
    scope_refinement: z.array(poolEntrySchema).default([])
      .describe("Pool for scope-refinement steps."),
  })
  .catchall(z.array(poolEntrySchema))
  .default({
    orchestration: [],
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
    scope_refinement: [],
  })
  .describe(
    `Weighted dispatch pools keyed by workflow step. ${POOL_STEP_NAMES} `
    + "Each value is an array of `{agentId, weight}` entries; empty arrays "
    + "are valid and mean \"no agents eligible for this step\". Used when "
    + "`dispatchMode = \"advanced\"`.",
  );

export const foolerySettingsSchema = z.object({
  agents: agentsMapSchema,
  actions: actionAgentMappingsSchema,
  backend: backendSettingsSchema,
  defaults: defaultsSettingsSchema,
  scopeRefinement: scopeRefinementSettingsSchema,
  pools: poolsSettingsSchema,
  dispatchMode: dispatchModeSchema,
  maxConcurrentSessions: z.number().int().min(1).max(20).default(5).describe(
    "Upper bound on concurrent interactive agent sessions. Range 1–20. "
    + "Default: 5.",
  ),
  maxClaimsPerQueueType: z.number().int().min(1).max(50).default(10).describe(
    "Upper bound on in-flight claims per queue type (prevents runaway "
    + "dispatching). Range 1–50. Default: 10.",
  ),
  terminalLightTheme: z.boolean().default(false).describe(
    "Render integrated terminals with a light theme. Default: false (dark).",
  ),
}).describe(
  "Foolery user-level settings. Written to `~/.config/foolery/settings.toml`. "
  + "Authoritative source: `src/lib/schemas.ts`. Live JSON Schema: "
  + "`foolery config schema`.",
);

export type RegisteredAgentConfig = z.infer<typeof registeredAgentSchema>;
export type ActionAgentMappings = z.infer<typeof actionAgentMappingsSchema>;
export type BackendSettings = z.infer<typeof backendSettingsSchema>;
export type DefaultsSettings = z.infer<typeof defaultsSettingsSchema>;
export type ScopeRefinementSettings = z.infer<typeof scopeRefinementSettingsSchema>;
export type PoolEntry = z.infer<typeof poolEntrySchema>;
export type DispatchMode = z.infer<typeof dispatchModeSchema>;

type FoolerySettingsSchemaShape = z.infer<typeof foolerySettingsSchema>;

type BasePoolsSettings = {
  orchestration: PoolEntry[];
  planning: PoolEntry[];
  plan_review: PoolEntry[];
  implementation: PoolEntry[];
  implementation_review: PoolEntry[];
  shipment: PoolEntry[];
  shipment_review: PoolEntry[];
  scope_refinement: PoolEntry[];
};

export type PoolsSettings = BasePoolsSettings
  & Partial<Record<string, PoolEntry[]>>;

export type FoolerySettings = Omit<FoolerySettingsSchemaShape, "pools"> & {
  pools: PoolsSettings;
};
