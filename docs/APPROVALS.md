# Approval Harnesses

Foolery approval validation is manual-only because it launches real agent CLIs
and may temporarily touch user config under `~/.config`. Do not add these runs
to `bun run test`, `bun run test:all`, or CI.

The canonical manual entrypoint is:

```bash
bash scripts/test-cli-approvals-manual.sh \
  --provider codex \
  --repo /path/to/knots-backed/repo
```

Use `--provider all` to run Codex, Claude Code, and OpenCode in sequence. The
script exits `0` when every requested provider passes, `2` when every
non-passing provider is blocked by a known missing implementation, and `1` for
real harness failures or config-restore failures.

## What Passing Means

A provider passes only when the harness proves the full round trip:

1. Foolery starts the selected provider in a mode that can force approval.
2. The terminal SSE stream emits `FOOLERY APPROVAL REQUIRED`.
3. `/beats?view=finalcut&tab=approvals` shows the matching pending approval.
4. Foolery approves the first request through the user-facing approval path.
5. The agent continues and emits a provider-specific success marker.
6. The validation file contains the same token as the success marker.
7. The terminal session is terminated cleanly, or killed after timeout.
8. Any protected config files are restored and checksum-verified.

Visibility without continuation is not a pass. That distinction matters because
Foolery can currently display approval requests even when provider reply wiring
is not complete.

## Config Safety

`scripts/test-cli-approvals-manual.sh` owns config protection. On every run it:

- creates a timestamped `0700` backup root outside the repository,
- snapshots `~/.config/foolery/settings.toml`,
- snapshots OpenCode config using `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, or
  `~/.config/opencode`,
- records existence, kind, mode, checksum, and backup path in a manifest,
- restores every protected path on success, failure, `SIGINT`, or timeout,
- verifies checksums and modes after restore,
- prints a red restore-failure banner and exits non-zero if restore fails.

The Node driver may rewrite Foolery settings during a run so only one provider
is eligible for dispatch. When it selects Claude Code, it also temporarily sets
that selected agent to `approvalMode = "prompt"` so omitted/default settings do
not keep the harness in autonomous bypass mode. Original settings are restored
by the shell trap. For OpenCode, the preferred path is a temporary
`OPENCODE_CONFIG` file inherited by the script-managed dev server, rather than
modifying global OpenCode config.

## Harness Flow

The wrapper runs `scripts/test-cli-approvals-manual.mjs`, which performs the
provider checks:

1. Optionally rewrites the backed-up Foolery settings for one provider.
2. Starts a disposable dev server unless `--base-url` or `FOOLERY_BASE_URL` is
   supplied.
3. Creates an approval-harness knot in the target repo, unless `--beat-id` is
   supplied.
4. Calls `POST /api/terminal` with `{ beatId, _repo, prompt }`; this is still
   a take/scene terminal session and must use the provider interactive
   transport, never `opencode run`, `codex exec`, or any other one-shot path.
5. Reads `GET /api/terminal/{sessionId}` as SSE until the first approval
   banner is observed.
6. Opens `/beats?view=finalcut&tab=approvals&repo=<repo>` with Playwright and
   verifies the approval row contains the session/provider context.
7. Clicks the first visible `Approve once`, `Allow once`, or `Approve` control.
8. Reconnects to SSE and waits for `FOOLERY_APPROVAL_CONTINUED_* <token>`.
9. Verifies `.approval-validation/<provider>.txt` contains the same token.
10. Calls `POST /api/terminal/{sessionId}/terminate`; after timeout it falls
    back to `POST /api/terminal/{sessionId}/kill`.

Set `FOOLERY_APPROVAL_SKIP_BROWSER=1` or pass `--skip-browser` to skip the
Playwright UI assertion while debugging API behavior. A skipped browser check
should not be treated as release-quality validation.

Use `node scripts/test-cli-approvals-manual.mjs --dry-helper-checks` for the
offline harness self-check. It verifies the Claude `approvalMode = "prompt"`
temporary mutation and the OpenCode split-extractor blocker heuristic without
launching provider CLIs or touching host config.

## Provider Matrix

| Provider | Force approval | Approve first request | Continuation marker |
| --- | --- | --- | --- |
| Codex | Run app-server with approval policy other than `never`; prompt asks for a shell/write action. | Foolery must preserve the native Codex request identity and respond through the structured approval path. | `FOOLERY_APPROVAL_CONTINUED_CODEX <token>` |
| Claude Code | Launch stream-json without `--dangerously-skip-permissions`, using default permission mode. | Foolery must respond to the native Claude permission request. | `FOOLERY_APPROVAL_CONTINUED_CLAUDE <token>` |
| OpenCode | Run with `permission` rules that make `edit` and `bash` ask. | Map `Approve once` to `POST /session/:id/permissions/:permissionID` with `response="once"` and `remember=false`. | `FOOLERY_APPROVAL_CONTINUED_OPENCODE <token>` |

The harness reports `BLOCKED` instead of `FAIL` for known missing
implementation paths:

- Codex still starts with `approvalPolicy: "never"`.
- Codex approval requests do not carry enough identity to respond.
- Claude still launches with `--dangerously-skip-permissions`.
- Claude emits a permission shape Foolery does not extract.
- The selected provider has no implemented Foolery approve/reject action.

Older OpenCode-specific blockers covered missing approval-event extraction and
missing permission ids. Those should not trigger with the current
implementation.

Use `--allow-known-blockers` only when debugging a newly landed provider fix
before the source-code blocker heuristic has been updated.

## Current Implementation Findings

Foolery converts supported approval events into a terminal banner with marker
`FOOLERY APPROVAL REQUIRED`. The live terminal connection then creates an
approval entry, toast, global banner, and inbox notification.

Important files:

- `src/lib/approval-request-visibility.ts` extracts supported request shapes.
- `src/lib/opencode-approval-request.ts` handles OpenCode `permission.asked`
  and `permission.updated` extraction.
- `src/lib/agent-session-runtime-events.ts` emits approval banners.
- `src/lib/terminal-approval-session.ts` stores pending approval reply
  records and routes implemented responders.
- `src/lib/session-connection-manager.ts` stores approvals and notifications.
- `src/components/final-cut-view.tsx` renders the Escalations tabs.
- `src/components/approval-escalations-panel.tsx` renders approval rows.

Currently recognized shapes include:

- Codex `mcpServer/elicitation/request`.
- Gemini `session/request_permission`.
- Copilot `user_input.requested`.
- Claude-style `AskUserQuestion` tool-use blocks.
- OpenCode `permission.asked` and `permission.updated`.

OpenCode approval rows now expose Approve, Always, and Reject when the
request carries a native session id plus permission id. The responder posts to
`POST /session/:id/permissions/:permissionID` and maps Foolery actions to
OpenCode `once`, `always`, and `reject` responses. Claude and Codex may still
need responder wiring after approval visibility is forced.

## Manual Recovery

If the harness is interrupted and reports a restore failure:

1. Read the printed backup root.
2. Inspect `manifest.tsv` inside that directory.
3. Restore the listed protected files from the `item-*` backup paths.
4. Run `foolery config validate` against the restored Foolery settings.
5. Re-run the harness with `FOOLERY_KEEP_APPROVAL_TEST_DIR=1` if more log
   context is needed.

Never continue testing after a restore failure until the config files are back
in their expected state.
