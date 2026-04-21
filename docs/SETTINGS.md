# Foolery Settings

User-level configuration stored as TOML at `~/.config/foolery/settings.toml`.

## Authority and regeneration

The **authoritative spec** is the Zod schema at `src/lib/schemas.ts`
(`foolerySettingsSchema`). This document is a human-readable mirror of that
schema. When schema and doc disagree, schema wins.

- To emit the current schema as JSON Schema (Draft 2020-12):
  ```
  foolery config schema
  ```
- To validate a TOML file against the current schema:
  ```
  foolery config validate [path]       # default: ~/.config/foolery/settings.toml
  ```

Agents configuring Foolery should treat `foolery config schema` as the
source of truth for field names, types, ranges, and defaults.

## File format

TOML, with one section per logical subsystem. Top-level scalars live at the
document root; grouped settings live under named tables or arrays of tables.

```toml
dispatchMode = "advanced"
maxConcurrentSessions = 8
maxClaimsPerQueueType = 10
terminalLightTheme = false

[agents.claude-claude-opus-4-7]
command = "/Applications/cmux.app/Contents/Resources/bin/claude"
agent_type = "cli"
vendor = "claude"
provider = "Claude"
agent_name = "Claude"
lease_model = "opus/claude"
model = "claude-opus-4-7"
version = "4.7"

[actions]
take = ""
scene = ""
scopeRefinement = ""

[backend]
type = "auto"

[defaults]
profileId = ""
interactiveSessionTimeoutMinutes = 10

[scopeRefinement]
prompt = "..."

[[pools.implementation]]
agentId = "claude-claude-opus-4-7"
weight = 1
```

## Top-level fields

| Field                      | Type       | Default   | Range / values                            | Description |
|----------------------------|------------|-----------|-------------------------------------------|-------------|
| `dispatchMode`             | enum       | `"basic"` | `"basic"` \| `"advanced"`                 | `basic` uses one agent per action (`[actions]`); `advanced` uses weighted pools per workflow step (`[[pools.*]]`). |
| `maxConcurrentSessions`    | integer    | `5`       | 1–20                                      | Upper bound on concurrent interactive agent sessions. |
| `maxClaimsPerQueueType`    | integer    | `10`      | 1–50                                      | Upper bound on in-flight claims per queue type (guards against runaway dispatching). |
| `terminalLightTheme`       | boolean    | `false`   | —                                         | Render integrated terminals with a light theme. |
| `agents`                   | table      | `{}`      | See [`[agents.<id>]`](#agentsid) below    | Registered agents, keyed by agent id. |
| `actions`                  | table      | all `""`  | See [`[actions]`](#actions) below         | One-agent-per-action mapping (Basic dispatch only). |
| `backend`                  | table      | `{type="auto"}` | See [`[backend]`](#backend) below   | Internal backend selection. |
| `defaults`                 | table      | see below | See [`[defaults]`](#defaults) below       | Defaults for beat creation and interactive sessions. |
| `scopeRefinement`          | table      | see below | See [`[scopeRefinement]`](#scoperefinement) below | Scope Refinement prompt configuration. |
| `pools`                    | table      | all `[]`  | See [`[[pools.<step>]]`](#poolsstep) below | Weighted dispatch pools per workflow step (Advanced dispatch). |

## `[agents.<id>]`

Registered agents. Each agent gets its own table under `agents`.

**Agent id convention:** `<vendor>-<model-slug>` — for example,
`claude-claude-opus-4-7`, `codex-gpt-5-4`, `opencode-openrouter-z-ai-glm-5`.
Non-alphanumerics in the model portion are lowercased and replaced with `-`.

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `command`      | string | **yes**  | Absolute path or PATH-resolvable name of the CLI to invoke (e.g. `/Applications/cmux.app/Contents/Resources/bin/claude`, `codex`). |
| `agent_type`   | string | no       | Integration type. Typically `"cli"`. |
| `vendor`       | string | no       | Short vendor key used as the agent id prefix (e.g. `claude`, `codex`, `opencode`, `gemini`, `copilot`). |
| `provider`     | string | no       | Display name of the provider (e.g. `Claude`, `Codex`, `OpenCode`). |
| `agent_name`   | string | no       | Display name surfaced in the UI. Usually matches `provider`. |
| `lease_model`  | string | no       | Lease-mapping key used when a workflow names a lease model (e.g. `opus/claude`, `gpt`). Typical in Advanced dispatch. |
| `model`        | string | no       | Concrete model identifier passed to the CLI (e.g. `claude-opus-4-7`, `gpt-5.4`, `openrouter/z-ai/glm-5`). |
| `flavor`       | string | no       | Free-form variant tag (e.g. `mini`, `spark`). Surfaces in the model-picker UI. |
| `version`      | string | no       | Marketing version string (e.g. `4.7`, `5.4`). Informational. |
| `label`        | string | no       | Human-friendly override for the agent's display label; otherwise falls back to `provider`/`agent_name`. |

### Example

```toml
[agents.claude-claude-opus-4-7]
command = "/Applications/cmux.app/Contents/Resources/bin/claude"
agent_type = "cli"
vendor = "claude"
provider = "Claude"
agent_name = "Claude"
lease_model = "opus/claude"
model = "claude-opus-4-7"
version = "4.7"
```

## `[actions]`

One-agent-per-action mapping used **only when `dispatchMode = "basic"`**. In
Advanced dispatch these fields are ignored; see [`[[pools.<step>]]`](#poolsstep).

| Field             | Type   | Default | Description |
|-------------------|--------|---------|-------------|
| `take`            | string | `""`    | Agent id for the "Take!" action (execute one beat). Empty string means unassigned. |
| `scene`           | string | `""`    | Agent id for the "Scene!" action (multi-beat orchestration). Empty string means unassigned. |
| `scopeRefinement` | string | `""`    | Agent id for the Scope Refinement action. Empty string means unassigned. |

### Example

```toml
[actions]
take = "claude-claude-opus-4-7"
scene = "claude-claude-opus-4-7"
scopeRefinement = "claude-claude-sonnet-4-6"
```

## `[backend]`

Internal backend selection. Operators usually leave this at `auto`.

| Field   | Type | Default  | Values                                             | Description |
|---------|------|----------|----------------------------------------------------|-------------|
| `type`  | enum | `"auto"` | `"auto"`, `"cli"`, `"stub"`, `"beads"`, `"knots"`  | `auto` detects Knots/Beads on PATH at startup; `cli` pins to whichever is on PATH; `stub` uses the in-memory test backend; `beads` and `knots` pin a specific store. |

### Example

```toml
[backend]
type = "auto"
```

## `[defaults]`

User-facing defaults applied at beat creation and interactive-session
management.

| Field                              | Type    | Default | Range | Description |
|------------------------------------|---------|---------|-------|-------------|
| `profileId`                        | string  | `""`    | —     | Default workflow profile id for newly created beats. Empty string falls back to the built-in `autopilot` profile. |
| `interactiveSessionTimeoutMinutes` | integer | `10`    | 1–240 | Inactivity timeout for interactive agent sessions, in minutes. |

### Example

```toml
[defaults]
profileId = ""
interactiveSessionTimeoutMinutes = 15
```

## `[scopeRefinement]`

Scope Refinement prompt configuration.

| Field    | Type   | Default                                            | Description |
|----------|--------|----------------------------------------------------|-------------|
| `prompt` | string | Built-in default (see `scope-refinement-defaults.ts`) | Template prompt for the Scope Refinement agent. Supports `{{title}}`, `{{description}}`, `{{acceptance}}` placeholders substituted from the beat being refined. |

### Example

```toml
[scopeRefinement]
prompt = """
You are refining a newly created engineering work item.
Tighten the title, rewrite the description for clarity, and define or tighten acceptance criteria.

Current beat:
Title: {{title}}
Description:
{{description}}

Acceptance criteria:
{{acceptance}}
"""
```

## `[[pools.<step>]]`

Weighted dispatch pools keyed by workflow step. Each value is an **array of
tables** (note the TOML `[[...]]` syntax), where each table is a
`{agentId, weight}` entry.

**Used when `dispatchMode = "advanced"`.** Empty arrays are valid and mean
"no agents eligible for this step."

**Canonical step keys** (each defaults to `[]`):

- `orchestration`
- `planning`
- `plan_review`
- `implementation`
- `implementation_review`
- `shipment`
- `shipment_review`
- `scope_refinement`

Additional step names are permitted for custom workflows — the `pools` map
accepts any string key.

### Pool entry fields

| Field     | Type   | Default | Description |
|-----------|--------|---------|-------------|
| `agentId` | string | —       | Registered agent id (key from the `[agents.*]` map, e.g. `claude-claude-opus-4-7`). |
| `weight`  | number | `1`     | Relative selection weight within the pool. Non-negative; entries compete proportionally. |

### Example

```toml
[[pools.implementation]]
agentId = "claude-claude-opus-4-7"
weight = 2

[[pools.implementation]]
agentId = "codex-gpt-5-4"
weight = 1

[[pools.shipment]]
agentId = "codex-gpt-5-4-mini"
weight = 1
```

## Adding a new setting

1. **Extend the Zod schema in `src/lib/schemas.ts`** with an explicit
   `.default(...)` and `.describe("...")`.

   ```typescript
   export const backendSettingsSchema = z
     .object({
       type: z.enum(["auto", "cli", "stub", "beads", "knots"])
         .default("auto")
         .describe("Backend implementation. ..."),
       timeout: z.number().positive().default(300)
         .describe("Request timeout in seconds. Default: 300."),
     })
     .default({ type: "auto", timeout: 300 })
     .describe("Internal backend selection.");
   ```

   **Always provide explicit defaults** on both the field (`.default(...)`)
   and the section (`.default({...})`). Zod v4 does not cascade inner field
   defaults when the section-level default is `{}`.

2. **Use it in server-side code** via `loadSettings()` from
   `@/lib/settings`.

3. **Add a UI field** in `src/components/settings-sheet.tsx` (if
   user-facing), updating the `DEFAULTS` constant and `SettingsData`
   interface.

4. **Update this document** — add the new field to the relevant table and
   regenerate the example if applicable. Verify with `foolery config schema`
   and `foolery config validate`.

## Architecture notes

- **Storage**: TOML file on disk. Survives browser clears.
- **Caching**: Server-side settings are cached in memory for 30 seconds (TTL).
- **API**: `GET /api/settings` returns the current config; `PUT /api/settings`
  merges a partial update.
- **Defaults**: If the TOML file is missing or a key is absent, Zod defaults
  apply automatically.
- **Comments**: Saving settings through the UI will not preserve hand-written
  TOML comments.
