# Interactive Agent Session Protocol

This document is the source of truth for Foolery's interactive agent session
integrations. It describes the contract that new agent wrappers must satisfy so
they can run under the shared session runtime and terminal manager without
agent-specific branching.

The current implementation lives primarily in:

- `src/lib/agent-session-capabilities.ts`
- `src/lib/agent-adapter.ts`
- `src/lib/agent-session-runtime.ts`
- `src/lib/terminal-manager-initial-io.ts`
- `src/lib/terminal-manager-take-child.ts`
- `src/lib/terminal-manager-take-iteration.ts`
- `src/lib/terminal-manager-workflow.ts`

## 1. Lifecycle State Machine

Every interactive session must move through this lifecycle:

`start -> prompt_sent -> active_turn -> turn_complete -> optional_follow_up ->
draining -> exited -> validated`

State meanings:

| State | Meaning | Entry condition | Exit condition |
| --- | --- | --- | --- |
| `start` | Wrapper has resolved dialect, capabilities, args, cwd, and process wiring. | Child process is spawned and stdout/stderr/close/error handlers are attached. | First prompt is delivered or delivery fails. |
| `prompt_sent` | The first prompt has been accepted by the transport. | Interactive: `sendUserTurn()` writes a JSON user message to stdin. One-shot: prompt is already in argv when the child is spawned. | First stream activity arrives or the wrapper closes because prompt delivery failed. |
| `active_turn` | The wrapper is receiving agent stream activity for the current turn. | Any normalized event other than the final turn result is observed. | A normalized turn result is observed. |
| `turn_complete` | The agent declared the current turn finished. | The runtime normalizes a result event and marks `resultObserved=true`. | A follow-up is sent or stdin close is scheduled. |
| `optional_follow_up` | Another prompt is sent within the same process. | `onResult()` returns `true` after sending an in-session follow-up. | The follow-up prompt is accepted and the session returns to `active_turn`, or follow-up delivery fails. |
| `draining` | No more prompts will be sent; the wrapper is waiting for process shutdown. | Interactive stdin is closed immediately or after the grace timer. One-shot sessions enter this state as soon as the turn result is observed. | The child emits `close` or `error`. |
| `exited` | The child process is gone and the wrapper has flushed final buffered output. | `close` or `error` handlers finish runtime cleanup. | Backend state validation/classification completes. |
| `validated` | Foolery has classified the workflow outcome. | Post-exit beat state is fetched and checked against workflow rules. | Session ends, retries spawn, or rollback/abort handling takes over. |

Rules:

- Stream silence never advances the session beyond `active_turn`.
- `turn_complete` is necessary but not sufficient for workflow success.
- `validated` is the first state where Foolery can decide whether the claimed
  workflow action actually succeeded.

## 2. Declared Capabilities

Every agent dialect declares a capability record before the session starts.

| Dialect | Interactive | Prompt transport | Follow-up | Ask-user auto-response | Turn result detection | Stdin drain policy | Watchdog |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude` | yes | `stdin-stream-json` | yes | yes | `type-result` | `close-after-result` | none by default |
| `codex` (one-shot) | no | `cli-arg` | no | no | `type-result` via normalized `turn.completed`/`turn.failed`/`error` | `never-opened` | none by default |
| `codex` (interactive) | yes | `jsonrpc-stdio` via `codex app-server` | yes | no | `type-result` via translated `turn/completed` JSON-RPC notification | `close-after-result` | 30 s |
| `copilot` | no | `cli-arg` | no | yes | `type-result` | `never-opened` | none by default |
| `opencode` | no | `cli-arg` | no | no | `type-result` via normalized `step_finish` | `never-opened` | none by default |
| `gemini` | no | `cli-arg` | no | no | `status-result` | `never-opened` | none by default |

Required fields:

- `interactive`: whether stdin is opened as a bidirectional prompt channel.
- `promptTransport`: whether prompts travel on stdin JSONL or as CLI args.
- `supportsFollowUp`: whether another prompt may be sent after a turn result
  without respawning the process.
- `supportsAskUserAutoResponse`: whether `AskUserQuestion` tool requests should
  be answered automatically by the runtime.
- `resultDetection`: which raw stream signal maps to the normalized turn result.
- `stdinDrainPolicy`: whether stdin closes after a turn result or was never
  opened.
- `watchdogTimeoutMs`: inactivity threshold in milliseconds, or `null`.

Wrapper code must branch on capabilities, not on hard-coded dialect names.

## 3. Startup Handshake

Foolery's startup handshake is wrapper-driven, not agent-driven. The protocol is:

1. Resolve the agent dialect from the executable name.
2. Resolve the capability record for that dialect.
3. Build the spawn args from the capability-driven transport mode.
4. Create the shared session runtime with:
   - dialect
   - capabilities
   - line normalizer
   - terminal event sink
   - interaction log
   - optional `onResult()` follow-up hook
5. Spawn the child in detached mode with:
   - `stdio[0]="pipe"` only for interactive agents
   - `stdio[0]="ignore"` for one-shot agents
   - `stdout` and `stderr` always piped
6. Wire stdout, stderr, close, and error handlers before prompt delivery.
7. Deliver the initial prompt using the capability-selected transport.

There is no separate "session ready" message from the child. A session becomes
live when the process is spawned and the wrapper has wired the runtime.

## 4. Prompt Delivery Contract

### Interactive transport

Interactive agents receive prompts as newline-delimited JSON objects:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "<prompt>" }]
  }
}
```

Contract:

- The initial prompt is sent after spawn through `sendUserTurn()`.
- Follow-up prompts use the exact same format.
- Prompt writes are rejected if stdin is destroyed, ended, or already marked
  closed by the runtime.

### One-shot transport

One-shot agents receive the prompt in argv at spawn time. No stdin prompt
channel exists, so:

- there is no in-session follow-up,
- stdin is never opened,
- a new turn requires a new process.

## 5. Normalized Stream-Event Contract

The shared runtime consumes raw JSONL and normalizes it into a small semantic
contract. Later layers should depend on these semantics, not dialect-native
event names.

| Semantic event | Normalized shape | Meaning | Typical terminal emission |
| --- | --- | --- | --- |
| `assistant_text` | `assistant.message.content[]` text block | User-visible assistant output | `stdout` |
| `tool_use` | `assistant.message.content[]` tool-use block | Assistant invoked a tool | `stdout` |
| `tool_result` | `user.message.content[]` tool-result block | Tool output returned to the assistant transcript | `stdout` |
| `ask_user` | `tool_use` with `name="AskUserQuestion"` | Agent requested a human decision | `stdout`, optionally followed by an auto-answer write |
| `detail_delta` | `stream_event` | Non-final reasoning or token deltas | `stdout_detail` |
| `turn_result` | `{ type: "result", result, is_error }` | The current turn is finished | formatted output plus turn-complete state |
| `session_error` | `stderr` terminal event or a normalized error result | Process/runtime-level failure information | `stderr` |
| `session_end` | terminal `exit`, followed by SSE `stream_end` | The child has exited and the server is closing the stream | `exit` then `stream_end` |

Dialect mappings in the current implementation:

- Claude passes through its stream-json events directly.
- Codex normalizes:
  - `item.started(command_execution)` -> `tool_use`
  - `item.completed(agent_message)` -> `assistant_text`
  - `item.completed(command_execution)` -> `tool_result`
  - `turn.completed` -> successful `turn_result`
  - `turn.failed` or `error` -> error `turn_result`
- Copilot normalizes streamed message deltas, assistant messages, tool requests,
  and `user_input.requested` into the same assistant/tool contract, with
  `session.task_complete` and `session.error` as turn results.
- OpenCode normalizes `text` into `assistant_text` and `step_finish` into the
  turn result.
- Gemini normalizes assistant `message` events into `assistant_text` and uses
  `result.status` to decide whether the turn result is an error.

## 6. Turn Complete vs Step Complete vs Session End

These are distinct protocol boundaries:

- Turn complete:
  The runtime observes a normalized `turn_result`. This means the agent is done
  answering the current prompt.
- Step complete:
  Foolery only treats the workflow action as complete after the child exits and
  the backend confirms the beat moved to the expected queue state. For take-loop
  sessions, success is classified only when `exitCode === 0` and the post-exit
  beat state matches the next queue state for the claimed step or the prior
  queue state for a review rejection.
- Session end:
  The server emits terminal `exit`, then sends SSE `stream_end`, and only then
  is the stream allowed to close cleanly.

Implications:

- A `turn_result` does not prove the process is done.
- A clean process exit does not prove the workflow step succeeded.
- Stream silence proves nothing on its own.

## 7. Follow-Up Prompts and Stdin Closure

Follow-up prompts are only valid for interactive agents with `supportsFollowUp`.

Current behavior:

- On every normalized turn result, the runtime calls `onResult()`.
- If `onResult()` sends a follow-up prompt successfully, the session enters
  `optional_follow_up` and stdin remains open.
- If no follow-up is sent, stdin close is scheduled after
  `INPUT_CLOSE_GRACE_MS` (`2000ms`).
- Any non-result normalized event cancels a pending stdin-close timer.
- One-shot agents never open stdin, so their drain policy is `never-opened`.

Foolery currently uses the follow-up channel for interactive ship-completion
prompts. The follow-up is sent inside the same process and must not be modeled
as a separate session.

## 8. Exit, Draining, and Post-Exit Validation

Wrapper responsibilities after the last prompt:

1. Flush any partial buffered line on process close.
2. Dispose runtime timers and mark stdin closed.
3. Remove stdout/stderr listeners and clear the tracked process handle.
4. Wait for the process `close` or `error` event before finalizing the session.

For non-take-loop sessions:

- process exit triggers queue-terminal invariant enforcement,
- then `finishSession()` records terminal status and emits `exit`.

For take-loop sessions:

1. Process exit fetches the post-exit backend state.
2. Foolery logs the claimed state and post-exit state.
3. Success classification is based on both exit code and backend transition.
4. Invariant repair may roll the beat back if the process exited while the beat
   was still left in an agent-owned action state.
5. Only after that validation may Foolery end the session or retry.

Workflow success therefore requires both:

- an agent/session completion signal, and
- post-exit backend validation.

Never treat stream exhaustion or a turn result as workflow success by itself.

## 9. Watchdogs, Retries, and Aborts

### Inactivity watchdog

- The runtime resets the watchdog on every normalized event.
- If the timer fires before a turn result, `exitReason` becomes `timeout` and
  the wrapper terminates the process group.
- Current built-in dialects set `watchdogTimeoutMs=null`, so watchdogs are
  opt-in capability settings rather than always-on behavior.

### Process-group termination

- Termination targets the detached process group first with `SIGTERM`.
- After `5000ms`, Foolery escalates to `SIGKILL`.
- If negative-PID group kill fails, the runtime falls back to `child.kill()`.
- Abort and watchdog paths both use this same process-group rule so descendant
  processes are not left running.

### Retry handoff across agents

- Non-zero exit codes trigger post-exit validation, failure recording, and
  lease/outcome audit writes.
- The failed agent is excluded from the current queue type.
- Foolery asks `buildNextTakePrompt()` for another take.
- If the next take chooses a different agent, the wrapper emits
  `agent_switch` before spawning the next child.
- Retry is allowed only after the previous child has exited and backend state
  has been validated or repaired.

### Abort semantics

- `abortSession()` marks the session status as `aborted` immediately.
- Abort then terminates the whole process group, not just the leader.
- Later `close` events must preserve the `aborted` status instead of rewriting
  it to `completed`.
- Aborted sessions must not spawn a new take-loop iteration, even if the child
  exits cleanly afterward.

## 10. Integration Requirements

A new interactive agent integration is conformant only if it satisfies all of
the following:

- declares a capability record before spawn,
- maps raw events into the normalized contract above,
- produces an explicit turn-result signal,
- supports the lifecycle state machine in this document,
- closes stdin according to capability-driven drain rules,
- waits for process exit before declaring session completion,
- defers workflow success to post-exit backend validation,
- uses process-group termination for watchdog and abort flows,
- preserves retry and abort semantics across agent handoffs.
