# Foolery ↔ Knots Agent Identity Contract

This document pins down how Foolery must supply agent identity (name, model,
version, provider, agent type) when talking to Knots via the `kno` CLI. The
authoritative upstream rule lives in
[Knots `docs/leases.md` — Agent identity propagation](https://github.com/acartine/knots/blob/main/docs/leases.md#agent-identity-propagation);
this doc is the Foolery-specific companion and is subordinate to it.

## The upstream rule Foolery must obey

Knots treats the lease as the declared source of agent identity. `kno lease
create` is the only subcommand that accepts agent-identity flags. On every
other subcommand — `kno claim`, `kno poll --claim`, `kno next`,
`kno rollback`, `kno gate evaluate`, `kno step annotate`, and
`kno update --add-note` / `--add-handoff-capsule` — the agent-identity
flags are deprecated. Knots accepts them syntactically so legacy callers
don't break, but **ignores their values at runtime** and emits a three-line
stderr warning telling the caller the flag is deprecated, its value is
dropped, and (if no lease is bound) how to create one.

Knots stamps `agent_name` / `agent_model` / `agent_version` onto notes,
handoff capsules, step-history entries, and gate decisions from the bound
lease's `agent_info`. If no lease is bound, those fields stay unset.

## Rules for Foolery

1. **Create a lease with full agent metadata, per claim.** On
   `kno lease create`, pass `--agent-name`, `--model`, `--model-version`,
   `--provider`, and `--agent-type`. This is the only place Foolery
   declares who is doing the work.

2. **Claim by lease.** Pass `--lease <id>` to `kno claim` and
   `kno poll --claim`. Do not pass any `--agent-*` flag — it will be
   ignored and Foolery will eat a deprecation warning in stderr on every
   call.

3. **Never pass agent-identity flags to any other `kno` subcommand.** In
   particular:
   - no `--agent-name` / `--agent-model` / `--agent-version` on
     `kno next`, `kno rollback`, `kno gate evaluate`, `kno step annotate`;
   - no `--note-agentname` / `--note-model` / `--note-version` on
     `kno update --add-note`;
   - no `--handoff-agentname` / `--handoff-model` / `--handoff-version` on
     `kno update --add-handoff-capsule`.

   Knots will ignore these values and warn. New Foolery `kno` wrappers must
   not add them; existing ones must drop them as they're touched.

4. **`--actor-kind` is orthogonal and stays per-command.** Continue to
   pass `--actor-kind agent` where the CLI accepts it. It is not an
   agent-identity flag and is not deprecated.

## Why

Foolery used to thread agent identity through each `kno` call. Two classes
of bug resulted: commands that forgot to plumb `--agent-name` wrote step
history with no attribution, and the note/handoff append paths had a
hardcoded `"foolery"` default that overrode the real agent. Centralising
identity on the lease removes both: one declaration per claim, and Knots
does the rest.

Running against a current `kno` makes the compliance story obvious —
non-compliant call sites now emit a three-line stderr warning per call,
and the record Knots writes is built from the lease regardless of what
Foolery passed.

## Foolery call sites

These are the only Foolery call sites that may pass agent metadata to
`kno`:

| Call site | Purpose | Passes agent metadata? |
|---|---|---|
| `createLease` — `src/lib/knots-operations.ts` | `kno lease create` | **yes — required** |
| `claimKnot` — `src/lib/knots-operations.ts` | `kno claim` | **no** — pass `--lease` only |
| `pollKnot` — `src/lib/knots-operations.ts` | `kno poll --claim` | **no** — pass `--lease` only |
| `nextKnot` — `src/lib/knots-operations.ts` | `kno next` | **no** |
| `updateKnot` (`appendNoteArgs`) — `src/lib/knots-operations.ts` | `kno update --add-note` | **no** — Knots stamps from lease |
| `updateKnot` (`appendHandoffArgs`) — `src/lib/knots-operations.ts` | `kno update --add-handoff-capsule` | **no** — Knots stamps from lease |
| Any other `kno` subcommand wrapper | — | **no** |

Callers that hold an `AgentInfo` (e.g. `src/lib/execution-backend-helpers.ts`
and `src/lib/backends/knots-backend-prompts.ts`) must flow it into the
lease creation path and then propagate the resulting lease id — not the
agent fields — through the rest of the claim lifecycle.

## What Foolery reads back

Agent fields arrive already populated on each record Knots returns:

- Steps: `agent_name`, `agent_model`, `agent_version` inside each
  `step_history` entry.
- Notes and handoff capsules: `agentname`, `model`, `version` on each
  entry.
- Gate decisions: the same fields in gate metadata.

The Retakes UI at `src/components/beat-metadata-details.tsx` already reads
these (accepting both snake_case and camelCase spellings). No client-side
mapping change is needed for identity to render correctly — the lease must
be created with the right agent metadata and everything else follows.

## Detecting non-compliance

Non-compliant call sites are now self-reporting: they produce the
three-line deprecation warning in `kno` stderr on every invocation. Watch
the Foolery server log and the session stderr surface — any `kno`
invocation emitting that banner is a Foolery bug, not a Knots bug.
