---
name: foolery-configure
description: >-
  Configure Foolery by writing a validated ~/.config/foolery/settings.toml and
  ~/.config/foolery/registry.json. Triggers: `foolery setup`, "configure
  foolery", "add an agent", "remove an agent", "change dispatch pools",
  "mount a repo". Works from any frontier agent (Claude, Codex, OpenCode,
  Gemini, Copilot) — use plain shell verbs, not harness-specific tooling.
---

# /foolery-configure

Produce a valid `~/.config/foolery/settings.toml` and
`~/.config/foolery/registry.json` by inspecting the host, asking the user at
most four questions, and validating the result against the shipped schema.

## Contract

The authoritative spec for `settings.toml` is the `foolery config` CLI:

- `foolery config schema` — prints JSON Schema (Draft 2020-12) of the file.
- `foolery config validate [path]` — exits `0` with `OK <path>`, `1` with a
  field-path breakdown on schema violation, `2` on file/TOML error.

Treat those two commands as the contract. Never guess field names or
defaults — read them from `foolery config schema`.

## Inputs to load before asking anything

Run these in the shell and read their output:

1. `cat ~/.config/foolery/settings.toml` — existing settings (may not exist).
2. `cat ~/.config/foolery/registry.json` — existing mounted repos (may not
   exist).
3. `foolery config schema` — current schema.
4. For each of `claude`, `codex`, `opencode`, `gemini`, `copilot`: run
   `command -v <name>` to see whether the CLI is on PATH. For each that
   resolves, probe for its available models (e.g. `claude --help`,
   `codex --help`, `opencode models`, `gemini models`,
   `copilot --list-models`). If a probe is unclear, ask the user which
   models they want — do not assume.

## The only four questions you may ask

Ask no more than these, in this order. Skip any whose answer is already
unambiguous from existing files or from a single detected CLI.

1. **Which agent vendors?** — from the detected subset of `claude`, `codex`,
   `opencode`, `gemini`, `copilot`.
2. **Which models per vendor?** — one or more per selected vendor, using the
   probed model list.
3. **Dispatch mode?** — `basic` (one agent per action) or `advanced`
   (weighted pools per workflow step).
4. **Which repos to mount?** — absolute paths to add under `registry.json`.

If a required value cannot be answered, stop and ask the user. Never pick a
default to paper over a missing answer — follow the "fail loudly, never
silently" rule.

## Preservation rules

Before writing, merge with what already exists. Never drop:

- Any `[agents.<id>]` entry that the user did not explicitly ask to remove.
- A pre-existing `[scopeRefinement].prompt` value — copy it through
  byte-for-byte, including whitespace.
- Any `[actions]`, `[backend]`, `[defaults]`, `[[pools.*]]`, or top-level
  scalar (`dispatchMode`, `maxConcurrentSessions`, etc.) the user did not
  explicitly change.
- Any `repos[]` entry already in `registry.json`.

New values override old ones only for keys the user answered above.

## Agent-id convention

Every registered agent key under `[agents.<id>]` follows
`<vendor>-<model-slug>`. Lowercase the model and replace non-alphanumerics
with `-`. Examples:

- `claude-claude-opus-4-7`
- `codex-gpt-5-4`
- `opencode-openrouter-z-ai-glm-5`
- `gemini-gemini-2-5-pro`
- `copilot-gpt-5`

Use the same id as the key under `[agents.<id>]`, as the value of
`[actions].take`/`scene`/`scopeRefinement` in basic mode, and as the
`agentId` inside `[[pools.<step>]]` entries in advanced mode.

## Canonical dispatch-pool step names

When writing `[[pools.<step>]]` tables in advanced mode, use exactly these
eight step keys — no others, no synonyms:

- `orchestration`
- `planning`
- `plan_review`
- `implementation`
- `implementation_review`
- `shipment`
- `shipment_review`
- `scope_refinement`

Each step maps to an array of `{agentId, weight}` tables. Empty arrays are
valid and mean "no agent eligible for this step" — leave the step unset only
if the user explicitly said so.

## Scope-refinement prompt

If `[scopeRefinement].prompt` is already set, preserve it unchanged. If it
is missing and the user did not supply one, leave the section out entirely
so the built-in default applies. Any prompt you do write must support the
placeholders `{{title}}`, `{{description}}`, and `{{acceptance}}` verbatim
(those are substituted from the beat being refined).

## Writing the files atomically

Both files must be swapped into place atomically so a crash mid-write
cannot leave a half-written config:

1. Ensure `~/.config/foolery/` exists (`mkdir -p`).
2. Write the new `settings.toml` contents to a tempfile in the same
   directory (e.g. `settings.toml.tmp.<pid>`). Do the same for
   `registry.json.tmp.<pid>` if you are changing `registry.json`.
3. **Preview before overwriting an existing file.** For each target that
   already exists on disk (skip this step entirely for a fresh install
   where the target does not yet exist):
   - Run `diff -u <existing> <tempfile>`. If the diff is empty there is
     nothing to apply — delete the tempfile and move on.
   - Otherwise pipe the diff through a pager so the user can scroll:
     `diff -u <existing> <tempfile> | less -R`. If `less` is not on
     `PATH`, fall back to `more -R`. Do not truncate or summarize the
     diff yourself — the user reads the full patch.
   - After the pager exits, prompt `Apply these changes? [y/N]` and read
     one line from stdin. Accept only exact `y`, `Y`, or `yes` as
     confirmation. Anything else (including empty input) aborts the swap
     for that target: delete the tempfile, leave the existing file
     untouched, and tell the user which targets were skipped.
4. `mv` each confirmed (or fresh-install) tempfile onto its target.

Use the same directory for the tempfile so the `mv` stays on one filesystem
and is a true rename.

## Validation gate

After writing, run `foolery config validate ~/.config/foolery/settings.toml`
and read its exit code.

- Exit `0`: validation passed. Tell the user the file is valid and stop.
- Exit `1`: report the field-path errors to the user, fix the offending
  fields, rewrite atomically, and re-run until exit `0`. Do not hand off a
  failing file.
- Exit `2`: the file is unreadable or the TOML is malformed. Report the
  error and fix it — do not hand off.

`registry.json` has no schema CLI; after writing, re-read it and confirm it
parses as JSON with a top-level `repos` array of `{path, name, addedAt}`
entries (plus an optional `memoryManagerType`).

## Completion criteria

You are done when all of the following hold:

1. `foolery config validate` exits `0`.
2. `~/.config/foolery/registry.json` parses as JSON and contains every
   previously mounted repo plus any the user just added.
3. The user's answers to the four questions (above) are reflected in the
   files; no answer was silently substituted with a default.
4. No `[agents.*]` entry, `[scopeRefinement].prompt`, or `repos[]` entry
   was dropped without an explicit instruction from the user.
