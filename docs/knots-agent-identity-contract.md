# Foolery ↔ Knots Agent Identity Contract

> **Status:** Canonical. This document is the single source of truth for how
> agent provider/model/version metadata flows through Foolery and into Knots.
> The companion document on the Knots side is
> [`~/knots/docs/leases.md` — Agent identity propagation](../../knots/docs/leases.md).
> Both documents must agree; if they drift, this one and `leases.md` are wrong
> together — fix both.

The shape of the problem is simple. There are five things to know about the
agent doing the work — `agent_type`, `provider`, `agent_name`, `model` (with
optional `flavor`), and `version`. There are dozens of places in the codebase
that could care about those values. **There is exactly one place that is
allowed to derive them from raw input, and exactly one moment at which that
derivation may run.** Everything else reads what was already derived.

## The Nine Rules

These are the load-bearing assertions. Every other rule, every diagram, every
acceptance criterion in this doc reduces to enforcing them.

1. **Canonical extraction.** When Foolery creates a Knots lease, it derives
   `{ agent_type, provider, agent_name, lease_model, version }` from the
   registered agent config (and only from there) using one provider-specific
   parser per provider. The rules are deterministic, documented, and
   irrefutable.
2. **Single moment.** Extraction happens exactly once per claim, at the
   moment Foolery calls `kno lease create`. After that call returns,
   extraction is over for the lifetime of that claim.
3. **Lease is authoritative.** From that point forward, Foolery only learns
   the agent identity by reading the knot or the lease. It never re-parses
   `command`, `model`, `version` from any other source.
4. **Knots stamps every artifact.** Knots reads the bound lease's
   `agent_info` and stamps `agent_name` / `agent_model` / `agent_version`
   onto every step-history entry, note, handoff capsule, and gate decision.
   This is the contract Knots makes with us.
5. **Runtime/session metadata is autostamp-derived.** Anywhere Foolery
   displays "who is working on this beat right now" — the active terminal,
   the beat row, the approval row — the data MUST come from the knot's
   most recent autostamped artifact (lease, last step, last handoff
   capsule). Not from environment variables. Not from CLI argv. Not from a
   parallel terminal-store field that someone wrote at spawn time.
6. **One function per app.** Extraction lives in one function. Resolution
   lives in one function. Construction of the lease payload lives in one
   function. Display formatting lives in one function. Per provider, per
   task. No duplicate branches scattered across files.
7. **Per-provider unit tests.** Each provider's extractor has a unit test
   that exhaustively covers the canonical inputs (model id strings,
   command names, env hints) and asserts the canonical outputs. Adding a
   new provider means adding a new test.
8. **Foolery only extracts at lease setup.** No other code path in Foolery
   may call the canonical extractor or its provider-specific helpers.
   Display, audit, telemetry, history rendering — all of them read
   already-canonical fields off the knot/lease/artifact.
9. **Knots preserves lease metadata per its documented contract.** The
   lease is immutable identity. Once stamped onto an artifact by Knots,
   the metadata travels with that artifact forever. Foolery treats those
   stamped fields as final.

## End-to-End Flow

```mermaid
flowchart TD
    subgraph Foolery_Extraction ["Foolery: extraction (one-time, per claim)"]
        A[Registered agent config<br/>settings.toml: agents.&lt;id&gt;] -->|"raw {command,model,version,...}"| B[Per-provider canonical extractor<br/>agent-identity.ts]
        B -->|"normalised"| C[toCanonicalLeaseIdentity<br/>agent-identity.ts:457"]
        C -->|"CanonicalLeaseIdentity"| D[toExecutionAgentInfo<br/>agent-identity.ts:492"]
        D -->|"ExecutionAgentInfo"| E[ensureKnotsLease<br/>knots-lease-runtime.ts:58"]
        E -->|"createLease(...)"| F["kno lease create<br/>knots-operations.ts:332"]
    end

    subgraph Knots_Stamping ["Knots: stamping (authoritative thereafter)"]
        F -->|"lease_id"| G[Bound lease<br/>knot.lease_id, lease.agent_info]
        G -->|"resolve_lease_agent_info"| H[Step-history entry]
        G -->|"resolve_lease_agent_info"| I[Note]
        G -->|"resolve_lease_agent_info"| J[Handoff capsule]
        G -->|"resolve_lease_agent_info"| K[Gate decision]
    end

    subgraph Foolery_Display ["Foolery: display (read-only consumers)"]
        H --> L[Beat metadata renderer]
        I --> L
        J --> L
        K --> M[Approval escalation panel]
        H --> M
        G --> N[Active terminal label]
    end

    classDef forbidden stroke:#c00,stroke-width:2px,fill:#fee;
    classDef canonical stroke:#080,stroke-width:2px,fill:#efe;
    class B,C,D,E,F canonical
    class L,M,N forbidden
```

The canonical (green) path is a one-way street: raw → normalised → lease →
stamped artifact → display. The display layer (red border) is **forbidden**
from re-deriving anything — it reads what's already on the artifact.

## Per-Provider Extraction Rules

Each row is the **only** way Foolery is allowed to map raw config to
canonical fields for that provider. The function name in the last column is
the **only** function that may run for that provider.

| Provider | Detection (from `command`) | `provider` | `agent_name` | `model` | `flavor` | `version` | Canonical extractor |
|---|---|---|---|---|---|---|---|
| Claude | `command` contains "claude" | `"Claude"` | `"Claude"` (display label of `command`) | `"claude"` if family matched | `"opus"` / `"sonnet"` / `"haiku"`, plus `-1m` or `-fast` suffix | first numeric segment after family, normalised to dot form (e.g. `4-7` → `4.7`) | [`normalizeClaudeModel`](../src/lib/agent-identity.ts) |
| Codex (OpenAI) | `command` contains "codex", "chatgpt", or "openai" | `"Codex"` | `"Codex"` | `"gpt"` or `"chatgpt"` | `codex-max` / `codex-mini` / `codex-spark` / `codex` / `mini` (if matched) | numeric after `gpt-` / `chatgpt-` | [`normalizeCodexModel`](../src/lib/agent-identity.ts) |
| Gemini | `command` contains "gemini" | `"Gemini"` | `"Gemini"` | `"gemini"` always | `pro` / `flash` / `flash-lite`, optionally `-preview` | numeric after `gemini-` | [`normalizeGeminiModel`](../src/lib/agent-identity.ts) |
| Copilot | `command` contains "copilot" | depends on inner model: Codex/Claude/Gemini if model hints, else `"Copilot"` | `"Copilot"` | inherited from inner extractor | inherited | inherited | [`normalizeCopilotModel`](../src/lib/agent-identity.ts) |
| OpenCode | `command` contains "opencode" | `"OpenCode"` | `"OpenCode"` | full router-path string (e.g. `openrouter/moonshotai/kimi-k2.6`) | (none — encoded in path) | **none from runtime;** only honoured if explicitly recorded on the registered config | [`normalizeOpenCodeModel`](../src/lib/agent-identity.ts) **(see "Known gap" below)** |

**Order of precedence in `detectAgentProviderId`:** opencode → copilot →
claude → codex → gemini. This order matters. Adding a new provider means
deciding where it sits.

### Known gap: OpenCode does not yet have a canonical extractor

As of 2026-04-30, [`normalizeAgentIdentity`](../src/lib/agent-identity.ts)
treats OpenCode as a passthrough — it copies `model`, `flavor`, `version`
from the input AgentIdentityLike without parsing. This is why the agent
table can show a stale "version" (e.g. `4.7`) for an OpenCode terminal
running `openrouter/moonshotai/kimi-k2.6` — the OpenCode runtime version
of the binary is leaking into the model-version slot.

The fix is a `normalizeOpenCodeModel` helper that:

- splits the model on `/` and recognises the canonical 3-segment shape
  `<router>/<vendor>/<model-with-version>`;
- emits `provider` = `"OpenCode"`, `agent_name` = `"OpenCode"`,
  `model` = full path string,
  `flavor` = router (e.g. `openrouter`),
  `version` = the numeric segment of the trailing model token if any
  (e.g. `kimi-k2.6` → `2.6`); **never** from runtime/binary version;
- has a unit test parallel to `normalizeClaudeModel` /
  `normalizeCodexModel`.

This is the canonical knot's first acceptance criterion. See knot
[`foolery-2e97`](https://github.com/acartine/foolery) (run
`kno -C ~/foolery show foolery-2e97` or
`kno -C ~/foolery ls --tag canonical-agent-metadata`) for the full list.

## Canonical Functions (One Per Task)

These are the only functions in Foolery that may run during the extraction →
lease creation → display flow. Anything else that names provider/model/version
is a violation that needs to be pulled into one of these.

| Concern | Function | File:line | Inputs | Output |
|---|---|---|---|---|
| Per-provider parsing | `normalize{Claude,Codex,Gemini,Copilot,OpenCode}Model` | `src/lib/agent-identity.ts` | raw model string | `{ model, flavor, version }` |
| Provider detection | `detectAgentProviderId(command)` | `src/lib/agent-identity.ts:80` | command string | `AgentProviderId` enum |
| Identity resolution | `normalizeAgentIdentity(agent)` | `src/lib/agent-identity.ts:233` | `AgentIdentityLike` | `{ provider, model, flavor, version }` |
| Canonical lease payload | `toCanonicalLeaseIdentity(agent)` | `src/lib/agent-identity-canonical.ts` | `AgentIdentityLike` | `CanonicalLeaseIdentity` |
| Canonical persisted config | `toCanonicalAgentConfig(agent)` | `src/lib/agent-identity-canonical.ts` | `AgentIdentityLike` | `CanonicalAgentConfig` (superset of lease identity, adds `model` + `flavor`) |
| Execution shape | `toExecutionAgentInfo(agent)` | `src/lib/agent-identity-canonical.ts` | `AgentIdentityLike` | `ExecutionAgentInfo` |
| Lease creation | `ensureKnotsLease(input)` | `src/lib/knots-lease-runtime.ts:58` | `EnsureKnotsLeaseInput` (carries `ExecutionAgentInfo`) | `lease_id` |
| `kno lease create` wrapper | `createLease(opts)` | `src/lib/knots-operations.ts:332` | `CreateLeaseOptions` | `KnotRecord` |
| Display label (UI) | `formatAgentDisplayLabel(agent)` | `src/lib/agent-identity.ts:351` | `AgentIdentityLike` from a stamped artifact | string |
| Display parts (label + pills) | `parseAgentDisplayParts(agent)` | `src/lib/agent-identity.ts:403` | same | `{ label, pills[] }` |

Every other place that names these fields is a **consumer** — it reads
already-canonical data off a knot/lease/artifact and must not call the
extractors. The display functions (`formatAgentDisplayLabel`,
`parseAgentDisplayParts`) are tolerated as one-step *formatters* — they
take canonical fields and produce a string. They MUST NOT be the path that
fixes up bad data; if a caller is feeding them raw runtime hints they are a
symptom of a broken upstream.

### Sanctioned exceptions

Exactly one site outside `agent-identity*.ts` is permitted to invoke the
canonical extractor. It is the **registration write boundary**:

- **`src/lib/agent-config-normalization.ts:normalizeRegisteredAgentConfig`**
  — the single canonical write-side normaliser. Every code path that
  writes an agent record into `settings.toml` (manual `addRegisteredAgent`,
  CLI scan, auto-detect, load-time auto-migration) routes through this
  function, which calls `toCanonicalAgentConfig` exactly once and persists
  the canonical shape. The thin adapter `canonicalizeScanFields` in the
  same file lets the scan/detect paths consume canonical fields without
  importing `normalizeAgentIdentity` directly; it too is sanctioned.

After this function runs, the data on disk and on every downstream
`RegisteredAgentConfig` is canonical. Settings hydration
(`getRegisteredAgents()`), CLI target resolution
(`settings-agent-targets.ts:toCliTarget`), and pool resolution
(`agent-pool.ts:toAgentTarget`) are pure pass-through reads — they
project canonical fields onto their target shape without re-deriving.

A new caller that needs canonical fields MUST either route through
`normalizeRegisteredAgentConfig` / `canonicalizeScanFields` or be added
to this section with explicit justification — it MUST NOT invoke
`normalizeAgentIdentity` or `toCanonicalAgentConfig` directly.

## What Foolery Reads Back

Knots stamps these fields onto every artifact produced under a bound lease.
Foolery reads them; it does not recompute them.

| Knots artifact | Fields | Returned by |
|---|---|---|
| Step-history entry | `agent_name`, `agent_model`, `agent_version`, `lease_id` | `kno show <id> --json` → `step_history[]` |
| Note | `agentname`, `model`, `version`, `username` | `kno show <id> --json` → `metadata.notes[]` |
| Handoff capsule | `agentname`, `model`, `version`, `username` | `kno show <id> --json` → `metadata.handoff_capsules[]` |
| Gate decision | `agentname`, `model`, `version` | `kno gate evaluate --json` |
| Active lease | `agent_info: { agent_type, provider, agent_name, model, model_version }` | `kno lease show <lease-id> --json` |

The Retakes UI at `src/components/beat-metadata-details.tsx` and the beat
table column extras at `src/components/beat-column-defs-extra.tsx` are the
sanctioned readers. They render; they do not normalise.

## What Foolery Forbids Itself

The following are explicit violations of this contract. They generate a
stderr deprecation warning from `kno`, or they cause the symptom in the
screenshot at the top of the canonical knot, or both.

### 1. Passing agent-identity flags to non-`lease create` `kno` commands

`createLease` (`src/lib/knots-operations.ts:332`) is the **only** Foolery
caller permitted to pass `--agent-name` / `--model` / `--model-version` /
`--provider` / `--agent-type`.

```ts
// FORBIDDEN
await execWrite(["claim", id, "--agent-name", "claude", ...]);

// FORBIDDEN
args.push("--note-agentname", agent.name);

// FORBIDDEN
args.push("--handoff-model", agent.model);

// CORRECT
await execWrite(["claim", id, "--lease", leaseId]);
await execWrite(["update", id, "--add-note=...", "--note-username", "foolery"]);
```

`--note-username` and `--handoff-username` are **not** agent-identity
flags. We pass `"foolery"` for them deliberately — the orchestrator that
emitted the note is Foolery, the agent identity is stamped automatically
by Knots from the lease's `agent_info`.

`--actor-kind agent` on `claim`/`next` is also **not** an agent-identity
flag and stays.

### 2. Re-extracting metadata downstream of the lease

Anywhere Foolery has a knot, a lease id, or a stamped artifact, it has
canonical data. It must not re-run any extractor on raw fields.

```ts
// FORBIDDEN — runs the canonical extractor at display time
toActiveAgentInfo({
  agentCommand: terminal.agentCommand,
  agentName: terminal.agentName,
  model: terminal.agentModel,
  version: terminal.agentVersion,
});

// CORRECT — read what Knots already stamped
const lastStep = beat.step_history.at(-1);
return {
  agentName: lastStep.agent_name,
  model: lastStep.agent_model,
  version: lastStep.agent_version,
};
```

### 3. Storing agent fields outside the lease as runtime state

The terminal store currently holds `agentName`, `agentModel`, `agentVersion`,
`agentCommand` as separate fields ([`src/stores/terminal-store.ts:11-14`](../src/stores/terminal-store.ts)).
These are duplicate state that can drift from the lease. They must be
replaced with `leaseId` plus a hook that resolves the lease's `agent_info`
on demand. See acceptance criterion AC-3 in the canonical knot.

### 4. Multi-key fallbacks at read time

`src/components/beat-table-metadata.tsx` resolves agent fields by trying
`agentname` then `agentName` then `agent_name`, and the same for model
and version. Multi-key fallbacks are a symptom that data is being stamped
inconsistently — the fix is at the stamp site, not the read site. The read
site reads one canonical key.

### 5. Default literals that override canonical fields

```ts
// FORBIDDEN
provider = agent.provider ?? "claude";
model = agent.model ?? "opus";
agentName = agent.agent_name ?? agent.name ?? "Unknown";
```

If a canonical field is missing, the canonical extractor failed upstream.
Hard-fail per [`feedback_no_fallbacks_hard_fail_loudly.md`](../../.claude/projects/-Users-cartine-foolery/memory/feedback_no_fallbacks_hard_fail_loudly.md) —
throw, banner, name what's missing.

## Tests Required

Per provider, the following must exist in `src/lib/__tests__/`:

1. **Canonical input → canonical output** — every published model id for
   that provider parses to the documented `{ provider, model, flavor,
   version }` shape.
2. **Round-trip** — `toCanonicalLeaseIdentity(agent)` and
   `formatAgentDisplayLabel(canonical)` produce a label that matches the
   user's expectation in the agent table.
3. **`createLease` payload** — the `kno lease create` command line carries
   exactly `--agent-name`, `--model`, `--model-version`, `--provider`,
   `--agent-type` and nothing else identity-related.
4. **No leakage to non-lease-create commands** — `claimKnot`, `pollKnot`,
   `nextKnot`, `updateKnot` (note + handoff paths) must not include any
   `--agent-*`, `--note-agentname`, `--note-model`, `--note-version`,
   `--handoff-agentname`, `--handoff-model`, `--handoff-version` flag.
   `src/lib/__tests__/knots-coverage-crud.test.ts` and
   `src/lib/__tests__/knots-integration-operations.test.ts` already assert
   this — keep those tests green forever.

`src/lib/__tests__/knots-canonical-metadata.test.ts` is the harness for
1–3. Each new provider rule lands with a new case in there plus a
provider-specific test like `agent-identity-claude.test.ts`.

## Self-Audit: How to Verify Compliance

A bash one-liner that any agent or human can run from the foolery root to
spot regressions:

```bash
# Should return zero hits — anywhere outside agent-identity.ts that imports
# the per-provider normalisers is a violation.
grep -rn "normalize\(Claude\|Codex\|Gemini\|Copilot\|OpenCode\)Model" src/ \
  | grep -v "src/lib/agent-identity.ts" \
  | grep -v "__tests__"

# Should return zero hits — toActiveAgentInfo and friends should never be
# called outside the active-beats display path. The sanctioned write-side
# extractor `toCanonicalAgentConfig` lives in `agent-identity-canonical.ts`
# and is wrapped by `normalizeRegisteredAgentConfig` in
# `agent-config-normalization.ts`; both files are excluded below as the
# canonical exception. JSDoc references to `normalizeAgentIdentity` (i.e.
# comment-only mentions) are filtered too.
grep -rn "toActiveAgentInfo\|normalizeAgentIdentity" src/ \
  | grep -v "src/lib/agent-identity.ts" \
  | grep -v "src/lib/agent-identity-canonical.ts" \
  | grep -v "src/lib/agent-config-normalization.ts" \
  | grep -v "src/app/beats/" \
  | grep -v "__tests__" \
  | grep -vE ":\s+\*"

# Should return zero hits — no agent-identity flags on non-lease-create.
grep -rn -- "--agent-name\|--agent-model\|--agent-version" src/ \
  | grep -v "lease.*create" \
  | grep -v "__tests__" \
  | grep -v "// FORBIDDEN" \
  | grep -v "docs/"

# Should return zero hits — no env-var extraction.
grep -rn "process\.env\.\(ANTHROPIC\|OPENAI\|OPENROUTER\|MODEL\|CLAUDE\)_MODEL" src/
```

Anything that comes back from these greps is either documented as a
sanctioned exception in this file, or it's a bug.

## Cross-References

- Knots upstream rule:
  [`~/knots/docs/leases.md` — Agent identity propagation](../../knots/docs/leases.md#agent-identity-propagation)
- Settings shape: [`docs/SETTINGS.md` — Agents](./SETTINGS.md#agents)
- Memory: [`feedback_no_fallbacks_hard_fail_loudly.md`](../../.claude/projects/-Users-cartine-foolery/memory/feedback_no_fallbacks_hard_fail_loudly.md)
- The canonical knot: `foolery-2e97` (tag `canonical-agent-metadata`).
  Run `kno -C ~/foolery show foolery-2e97` to see acceptance criteria.

## Why This Document Exists

This is the third (or thirtieth, depending on how you count) iteration of
trying to make agent metadata behave. Each previous iteration fixed
symptoms — a wrong label here, a missing version there — without nailing
down the contract. This document is the contract. If a future change to
agent metadata cannot be expressed as a change to one of the rules, the
canonical extractor list, the per-provider rules table, or the forbidden
list above, then the change is happening at the wrong layer and will
re-introduce the inconsistency. **Push the change up to this contract
first; only then change code.**
