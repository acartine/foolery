# Foolery API Guide

Reference for agent clients automating Foolery operations. All endpoints live under the Foolery server (default `http://localhost:3000`).

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Common Patterns](#common-patterns)
- [Beats (Work Items)](#beats-work-items)
- [Dependencies](#dependencies)
- [Wave Planning](#wave-planning)
- [Terminal Sessions](#terminal-sessions)
- [Breakdown (AI Planning)](#breakdown-ai-planning)
- [Orchestration (Multi-Agent)](#orchestration-multi-agent)
- [Settings and Agents](#settings-and-agents)
- [Registry (Repository Management)](#registry-repository-management)
- [System](#system)
- [SSE Streaming Guide](#sse-streaming-guide)
- [Workflow Recipes](#workflow-recipes)
- [Error Handling](#error-handling)
- [OpenAPI Spec](#openapi-spec)

---

## Overview

Foolery is a local web UI and API for agent-driven software work. It sits on top of Knots and Beads backends and exposes JSON endpoints for creating, querying, and managing beats, dependencies, execution waves, terminal sessions, breakdown runs, and multi-agent orchestration.

Key facts:
- All endpoints return JSON and accept JSON request bodies.
- Multi-repo support works via the `_repo` query parameter or body field.
- The default base URL is `http://localhost:3000`.
- Long-running workflows also expose SSE endpoints for live progress.

## Authentication

Current local deployments do not require authentication. Foolery runs as a local service.

## Common Patterns

### Response Envelope

Success responses wrap data in one of two forms:

```json
{ "data": { ... } }
```

```json
{ "ok": true, "data": { ... } }
```

### Error Responses

```json
{ "error": "Human-readable error message" }
```

Validation errors include details:

```json
{
  "error": "Validation failed",
  "details": [{ "path": ["title"], "message": "Title is required" }]
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200  | Success |
| 201  | Created |
| 400  | Validation error |
| 404  | Not found |
| 409  | Edit conflict |
| 500  | Server error |
| 503  | Backend degraded (may include cached data as fallback) |

### Multi-Repo Targeting

Pass `_repo` to target a specific repository:
- As a query parameter: `GET /api/beats?_repo=/path/to/repo`
- As a body field: `{ "_repo": "/path/to/repo", ... }`

### Cached Fallback (503)

When the backend is degraded, some GET endpoints return cached data:

```json
{
  "data": { ... },
  "cached": true,
  "cachedAt": "2025-01-15T10:30:00.000Z"
}
```

---

## Beats (Work Items)

### List Beats

```
GET /api/beats
```

Query parameters:
- `_repo` — repository path
- `q` — search query string
- `state` — filter by state (e.g. `open`, `in_progress`, `closed`)

Response:
```json
{
  "data": [
    {
      "id": "abc-123",
      "title": "Implement login",
      "description": "...",
      "type": "work",
      "state": "open",
      "priority": 2,
      "labels": [],
      "created": "2025-01-15T10:00:00Z",
      "updated": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### Create Beat

```
POST /api/beats
```

Body:
```json
{
  "title": "Implement feature X",
  "description": "Details here",
  "type": "work",
  "priority": 2,
  "labels": ["frontend"],
  "assignee": "agent-1",
  "parent": "parent-beat-id",
  "profileId": "autopilot",
  "_repo": "/path/to/repo"
}
```

Required fields: `title`.

Optional fields: `description`, `type` (default `"work"`), `priority` (0-4, default 2), `labels` (default `[]`), `assignee`, `due`, `acceptance`, `notes`, `parent`, `estimate`, `profileId`, `workflowId`.

Response (201):
```json
{ "data": { "id": "abc-456", "title": "Implement feature X", ... } }
```

### Get Beat

```
GET /api/beats/{id}
```

Query parameters: `_repo`

Response:
```json
{
  "data": { "id": "abc-123", "title": "...", ... },
  "cached": false
}
```

### Update Beat

```
PATCH /api/beats/{id}
```

Body (all fields optional):
```json
{
  "title": "Updated title",
  "description": "New description",
  "state": "in_progress",
  "priority": 1,
  "labels": ["urgent"],
  "removeLabels": ["stale"],
  "assignee": "agent-2",
  "notes": "Implementation notes",
  "_repo": "/path/to/repo"
}
```

Response:
```json
{ "ok": true }
```

### Delete Beat

```
DELETE /api/beats/{id}
```

Query parameters: `_repo`

Response:
```json
{ "ok": true }
```

### Close Beat

```
POST /api/beats/{id}/close
```

Body:
```json
{
  "reason": "Completed implementation",
  "_repo": "/path/to/repo"
}
```

Both fields are optional. Closing a beat also triggers ancestor regroom (auto-closing parent beats whose children are all closed).

Response:
```json
{ "ok": true }
```

### Cascade Close

```
POST /api/beats/{id}/close-cascade
```

Two modes: preview and confirmed.

Preview mode (default):
```json
{ "confirmed": false, "_repo": "/path/to/repo" }
```

Response:
```json
{ "ok": true, "data": { "descendants": [ { "id": "child-1", ... } ] } }
```

Confirmed mode:
```json
{ "confirmed": true, "reason": "Scope reduced", "_repo": "/path/to/repo" }
```

Response:
```json
{ "ok": true, "data": { ... } }
```

### Ready Queue

```
GET /api/beats/ready
```

Returns beats that are `open` or `in_progress`, excluding those requiring human action and those whose parent chain is not visible.

Query parameters: `_repo`, `q` (search filter)

Response:
```json
{
  "data": [
    { "id": "abc-123", "title": "Ready beat", "state": "open", ... }
  ]
}
```

### Advanced Query

```
POST /api/beats/query
```

Body:
```json
{
  "expression": "state:open priority:<=1",
  "limit": 50,
  "sort": "priority",
  "_repo": "/path/to/repo"
}
```

Required: `expression`. Optional: `limit` (default 50), `sort`.

Response:
```json
{ "data": [ { "id": "...", ... } ] }
```

### Merge Beats

```
POST /api/beats/merge
```

Merges `consumedId` into `survivorId`. The consumed beat's description, notes, and labels are appended to the survivor. The consumed beat is closed.

Body:
```json
{
  "survivorId": "beat-keep",
  "consumedId": "beat-absorb",
  "_repo": "/path/to/repo"
}
```

Response:
```json
{ "ok": true, "data": { "survivorId": "beat-keep", "consumedId": "beat-absorb" } }
```

---

## Dependencies

### List Dependencies

```
GET /api/beats/{id}/deps
```

Query parameters: `_repo`

Response:
```json
{
  "data": [
    {
      "id": "other-beat",
      "dependency_type": "blocks",
      "title": "Blocking beat",
      "state": "open"
    }
  ]
}
```

### Add Dependency

```
POST /api/beats/{id}/deps
```

Creates a "blocks" relationship: the beat identified by `blocks` blocks the beat `{id}`.

Body:
```json
{
  "blocks": "target-beat-id",
  "_repo": "/path/to/repo"
}
```

Response (201):
```json
{ "ok": true }
```

### Batch Dependencies

```
GET /api/beats/batch-deps?ids=id1,id2,id3
```

Query parameters: `_repo`, `ids` (comma-separated, required)

Response:
```json
{
  "data": {
    "id1": [ { "id": "dep-a", "dependency_type": "blocks", ... } ],
    "id2": [],
    "id3": [ { "id": "dep-b", ... } ]
  }
}
```

---

## Wave Planning

```
GET /api/waves
```

Computes execution waves from all non-closed beats and their dependency graph. Returns a plan with topologically sorted waves, readiness analysis, and a recommended next action.

Query parameters: `_repo`

Response:
```json
{
  "data": {
    "waves": [
      {
        "level": 1,
        "beats": [
          {
            "id": "abc-123",
            "title": "First task",
            "type": "work",
            "state": "open",
            "priority": 2,
            "labels": [],
            "blockedBy": [],
            "readiness": "runnable",
            "readinessReason": "Ready to ship.",
            "waveLevel": 1
          }
        ],
        "gate": null
      }
    ],
    "unschedulable": [],
    "summary": {
      "total": 5,
      "runnable": 2,
      "inProgress": 1,
      "blocked": 2,
      "gates": 0,
      "unschedulable": 0
    },
    "recommendation": {
      "beatId": "abc-123",
      "title": "First task",
      "waveLevel": 1,
      "reason": "Ready to ship."
    },
    "runnableQueue": [
      { "beatId": "abc-123", "title": "First task", "waveLevel": 1, "reason": "Ready to ship." }
    ]
  }
}
```

### Readiness Values

| Value | Meaning |
|-------|---------|
| `runnable` | No blockers, eligible for execution |
| `in_progress` | Already being worked on |
| `blocked` | Waiting on dependencies |
| `gate` | Requires human action |
| `unschedulable` | Dependency cycle detected |

---

## Terminal Sessions

### List Sessions

```
GET /api/terminal
```

Response:
```json
{
  "data": [
    {
      "id": "session-uuid",
      "beatId": "abc-123",
      "beatTitle": "Task title",
      "status": "running",
      "startedAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### Create Session

```
POST /api/terminal
```

Body:
```json
{
  "beatId": "abc-123",
  "prompt": "Optional custom prompt",
  "_repo": "/path/to/repo"
}
```

Required: `beatId`.

Response (201):
```json
{
  "data": {
    "id": "session-uuid",
    "beatId": "abc-123",
    "status": "running",
    "startedAt": "2025-01-15T10:00:00Z"
  }
}
```

### Stream Session Output (SSE)

```
GET /api/terminal/{sessionId}
```

Returns a Server-Sent Events stream. See the [SSE Streaming Guide](#sse-streaming-guide) for details.

Event types: `stdout`, `stderr`, `exit`.

### Abort Session

```
DELETE /api/terminal
```

Body:
```json
{ "sessionId": "session-uuid" }
```

Response:
```json
{ "ok": true }
```

---

## Breakdown (AI Planning)

Breaks down a large beat into sub-beats using AI analysis.

### Start Breakdown

```
POST /api/breakdown
```

Body:
```json
{
  "parentBeatId": "large-beat-id",
  "_repo": "/path/to/repo"
}
```

Both fields are required.

Response (201):
```json
{
  "data": {
    "id": "session-uuid",
    "repoPath": "/path/to/repo",
    "parentBeatId": "large-beat-id",
    "status": "running",
    "startedAt": "2025-01-15T10:00:00Z"
  }
}
```

### Stream Breakdown (SSE)

```
GET /api/breakdown/{sessionId}
```

Returns a Server-Sent Events stream. Event types: `log`, `plan`, `status`, `error`, `exit`.

The `plan` event contains the breakdown plan:
```json
{
  "type": "plan",
  "data": {
    "summary": "Split into 3 implementation waves",
    "waves": [
      {
        "waveIndex": 1,
        "name": "Foundation",
        "objective": "Set up base infrastructure",
        "beats": [{ "title": "Create schema", "type": "work", "priority": 2 }]
      }
    ],
    "assumptions": ["Existing DB is PostgreSQL"]
  },
  "timestamp": 1705312800000
}
```

### Abort Breakdown

```
DELETE /api/breakdown
```

Body:
```json
{ "sessionId": "session-uuid" }
```

Response:
```json
{ "ok": true }
```

### Apply Breakdown Plan

```
POST /api/breakdown/apply
```

Creates sub-beats from the breakdown plan.

Body:
```json
{
  "sessionId": "session-uuid",
  "_repo": "/path/to/repo"
}
```

Response:
```json
{
  "data": {
    "createdBeatIds": ["new-1", "new-2", "new-3"],
    "waveCount": 2
  }
}
```

---

## Orchestration (Multi-Agent)

Plans and executes multi-agent work distribution across beats.

### List Sessions

```
GET /api/orchestration
```

Response:
```json
{
  "data": [
    {
      "id": "session-uuid",
      "repoPath": "/path/to/repo",
      "status": "completed",
      "startedAt": "2025-01-15T10:00:00Z",
      "objective": "Ship v2.0 features"
    }
  ]
}
```

### Start Orchestration

```
POST /api/orchestration
```

Body:
```json
{
  "_repo": "/path/to/repo",
  "objective": "Optional high-level objective"
}
```

Required: `_repo`.

Response (201):
```json
{
  "data": {
    "id": "session-uuid",
    "repoPath": "/path/to/repo",
    "status": "running",
    "startedAt": "2025-01-15T10:00:00Z"
  }
}
```

### Stream Orchestration (SSE)

```
GET /api/orchestration/{sessionId}
```

Returns a Server-Sent Events stream. Event types: `log`, `plan`, `status`, `error`, `exit`.

The `plan` event contains the orchestration plan:
```json
{
  "type": "plan",
  "data": {
    "summary": "3 scenes across 2 waves",
    "waves": [
      {
        "waveIndex": 1,
        "name": "Scene 1: Foundation",
        "objective": "Set up core infrastructure",
        "agents": [{ "role": "implementer", "count": 2 }],
        "beats": [{ "id": "beat-1", "title": "Schema migration" }]
      }
    ],
    "unassignedBeatIds": [],
    "assumptions": []
  },
  "timestamp": 1705312800000
}
```

### Abort Orchestration

```
DELETE /api/orchestration
```

Body:
```json
{ "sessionId": "session-uuid" }
```

Response:
```json
{ "ok": true }
```

### Apply Orchestration Plan

```
POST /api/orchestration/apply
```

Body:
```json
{
  "sessionId": "session-uuid",
  "_repo": "/path/to/repo",
  "waveNames": { "1": "Custom Wave Name" },
  "waveSlugs": { "1": "custom-slug" }
}
```

Required: `sessionId`, `_repo`. Optional: `waveNames`, `waveSlugs` (override generated names/slugs per wave index).

Response:
```json
{
  "data": {
    "applied": [
      {
        "waveIndex": 1,
        "waveId": "wave-id",
        "waveSlug": "scene-1-foundation",
        "waveTitle": "Scene 1: Foundation",
        "childCount": 3,
        "children": [
          { "id": "child-1", "title": "Schema migration" }
        ]
      }
    ],
    "skipped": []
  }
}
```

### Restage Orchestration

```
POST /api/orchestration/restage
```

Creates a new orchestration session from an edited plan (allows manual scene reorganization).

Body:
```json
{
  "_repo": "/path/to/repo",
  "objective": "Revised plan",
  "plan": {
    "summary": "Restaged 2 scenes",
    "waves": [
      {
        "waveIndex": 1,
        "name": "Scene 1",
        "objective": "Core work",
        "agents": [{ "role": "implementer", "count": 1 }],
        "beads": [{ "id": "beat-1", "title": "Task A" }]
      }
    ],
    "assumptions": [],
    "unassignedBeatIds": []
  }
}
```

Required: `_repo`, `plan` (must contain at least one wave with at least one beat).

Response (201):
```json
{
  "data": {
    "id": "new-session-uuid",
    "status": "completed",
    ...
  }
}
```

---

## Settings and Agents

### Get Settings

```
GET /api/settings
```

Response:
```json
{
  "ok": true,
  "data": {
    "agent": { "command": "claude" },
    "agents": {
      "claude-opus": { "command": "claude", "model": "opus" }
    },
    "actions": {
      "take": "claude-opus",
      "scene": "",
      "direct": "",
      "breakdown": ""
    },
    "backend": { "type": "auto" },
    "defaults": { "profileId": "" },
    "openrouter": { "apiKey": "", "enabled": false, "model": "" },
    "dispatchMode": "actions",
    "pools": { ... }
  }
}
```

### Update Settings (Full Replace)

```
PUT /api/settings
```

Body: full settings object. Response: `{ "ok": true, "data": { ... } }`.

### Patch Settings (Partial Merge)

```
PATCH /api/settings
```

Body: partial settings object. Same merge semantics as PUT.

Response:
```json
{ "ok": true, "data": { ... } }
```

### Get Action Mappings

```
GET /api/settings/actions
```

Response:
```json
{
  "ok": true,
  "data": { "take": "", "scene": "", "direct": "", "breakdown": "" }
}
```

### Update Action Mappings

```
PUT /api/settings/actions
```

Body:
```json
{ "take": "claude-opus", "scene": "claude-sonnet" }
```

### List Registered Agents

```
GET /api/settings/agents
```

Response:
```json
{
  "ok": true,
  "data": {
    "claude-opus": { "command": "claude", "model": "opus", "label": "Claude Opus" }
  }
}
```

### Register Agent

```
POST /api/settings/agents
```

Body:
```json
{
  "id": "claude-opus",
  "command": "claude",
  "model": "opus",
  "label": "Claude Opus"
}
```

Required: `id`, `command`. The id `"default"` is reserved.

Response:
```json
{ "ok": true, "data": { "claude-opus": { ... } } }
```

### Remove Agent

```
DELETE /api/settings/agents
```

Body:
```json
{ "id": "claude-opus" }
```

Response:
```json
{ "ok": true, "data": { ... } }
```

### Scan for Agents

```
GET /api/settings/agents/scan
```

Discovers agents available on the system.

Response:
```json
{
  "ok": true,
  "data": [
    { "id": "claude", "command": "claude", "path": "/usr/local/bin/claude", "installed": true }
  ]
}
```

---

## Registry (Repository Management)

### List Repositories

```
GET /api/registry
```

Response:
```json
{
  "data": [
    {
      "path": "/Users/me/project",
      "name": "project",
      "addedAt": "2025-01-15T10:00:00Z",
      "memoryManagerType": "knots"
    }
  ]
}
```

### Add Repository

```
POST /api/registry
```

Body:
```json
{ "path": "/Users/me/new-project" }
```

Response (201):
```json
{ "data": { "path": "/Users/me/new-project", "name": "new-project", ... } }
```

### Remove Repository

```
DELETE /api/registry
```

Body:
```json
{ "path": "/Users/me/old-project" }
```

Response:
```json
{ "ok": true }
```

### Browse Directories

```
GET /api/registry/browse?path=/Users/me
```

Returns directory entries with compatibility info (whether a directory contains a recognized memory manager).

Response:
```json
{
  "data": [
    {
      "name": "project",
      "path": "/Users/me/project",
      "memoryManagerType": "knots",
      "isCompatible": true
    }
  ]
}
```

---

## System

### Doctor (Diagnostics)

```
GET /api/doctor
```

Runs system diagnostics. Pass `?stream=1` for NDJSON streaming.

Response:
```json
{ "ok": true, "data": { ... } }
```

### Doctor Fix

```
POST /api/doctor
```

Runs diagnostics and applies fixes. Optionally pass strategies to control which fixes run.

Body (optional):
```json
{ "strategies": { "check-name": "fix-strategy" } }
```

Response:
```json
{ "ok": true, "data": { ... } }
```

### Version

```
GET /api/version
```

Query parameters: `force=1` to bypass cache.

Response:
```json
{
  "ok": true,
  "data": { ... }
}
```

### Capabilities

```
GET /api/capabilities
```

Query parameters: `repo` (note: uses `repo`, not `_repo`)

Response:
```json
{ "data": { ... } }
```

### Workflows

```
GET /api/workflows
```

Query parameters: `_repo`

Returns the list of workflow descriptors available for the target repository.

Response:
```json
{
  "data": [
    {
      "id": "autopilot",
      "label": "Autopilot",
      "mode": "granular_autonomous",
      "initialState": "open",
      "states": ["open", "in_progress", "shipped"],
      "terminalStates": ["shipped"]
    }
  ]
}
```

### Agent History

```
GET /api/agent-history
```

Query parameters:
- `_repo` — repository path
- `beatId` — filter by beat ID
- `beatRepo` — repository path for the beat (only used when `beatId` is set)
- `sinceHours` — only return history from the last N hours

Response:
```json
{ "data": [ ... ] }
```

### Agent History Message Types

```
GET /api/agent-history/message-types
```

Returns an index of message types found in agent history logs. Builds the index on first access.

Response:
```json
{ "data": { ... } }
```

---

## SSE Streaming Guide

Terminal, Breakdown, and Orchestration endpoints support Server-Sent Events (SSE) for real-time output streaming.

### Connecting

Send a GET request to the session's stream endpoint. No special `Accept` header is required; the response has `Content-Type: text/event-stream`.

```
GET /api/terminal/{sessionId}
GET /api/breakdown/{sessionId}
GET /api/orchestration/{sessionId}
```

### Event Format

Each event is a single `data:` line followed by two newlines:

```
data: {"type":"stdout","data":"Building project...\n","timestamp":1705312800000}

data: {"type":"exit","data":"0","timestamp":1705312801000}

```

### Event Types by Domain

**Terminal sessions:**

| Type | Data | Description |
|------|------|-------------|
| `stdout` | string | Standard output from the process |
| `stderr` | string | Standard error from the process |
| `exit` | string (exit code) | Process exited |

**Breakdown and Orchestration sessions:**

| Type | Data | Description |
|------|------|-------------|
| `log` | string | Progress log message |
| `plan` | object | The generated plan (BreakdownPlan or OrchestrationPlan) |
| `status` | string | Session status change |
| `error` | string | Error message |
| `exit` | string | Session finished |

### Buffering and Replay

Events are buffered server-side. When you connect, all previously emitted events are replayed immediately before live events begin streaming. This means you can connect to a session that has already started (or even finished) and still receive the full event history.

### Completion

Listen until you receive an `exit` event. The stream closes shortly after the exit event is sent. If the session has already exited when you connect, the buffered events (including the exit) are replayed and the stream closes automatically.

### Example (curl)

```bash
curl -N http://localhost:3000/api/terminal/session-uuid
```

### Example (JavaScript)

```javascript
const es = new EventSource("http://localhost:3000/api/terminal/session-uuid");
es.onmessage = (event) => {
  const parsed = JSON.parse(event.data);
  if (parsed.type === "exit") {
    console.log("Exit code:", parsed.data);
    es.close();
  } else {
    process.stdout.write(parsed.data);
  }
};
```

---

## Workflow Recipes

### Recipe 1: Create and Track a Beat

```bash
# Create a beat
curl -X POST http://localhost:3000/api/beats \
  -H "Content-Type: application/json" \
  -d '{"title": "Implement auth", "_repo": "/path/to/repo"}'
# Response: { "data": { "id": "abc-123", ... } }

# Start working on it
curl -X PATCH http://localhost:3000/api/beats/abc-123 \
  -H "Content-Type: application/json" \
  -d '{"state": "in_progress", "_repo": "/path/to/repo"}'

# ... do work ...

# Close when done
curl -X POST http://localhost:3000/api/beats/abc-123/close \
  -H "Content-Type: application/json" \
  -d '{"reason": "Implemented and tested", "_repo": "/path/to/repo"}'
```

### Recipe 2: Find Ready Work

```bash
# Get beats ready for execution
curl http://localhost:3000/api/beats/ready?_repo=/path/to/repo

# Or use waves for dependency-aware ordering
curl http://localhost:3000/api/waves?_repo=/path/to/repo
# Pick the first item from runnableQueue (lowest wave level, highest priority)
```

The `runnableQueue` array in the waves response is pre-sorted: lowest wave level first, then by priority. The `recommendation` field points to the single best next beat to work on.

### Recipe 3: Run a Terminal Session

```bash
# Start a session for a beat
curl -X POST http://localhost:3000/api/terminal \
  -H "Content-Type: application/json" \
  -d '{"beatId": "abc-123", "_repo": "/path/to/repo"}'
# Response: { "data": { "id": "session-uuid", ... } }

# Stream output (blocks until exit event)
curl -N http://localhost:3000/api/terminal/session-uuid
# Each line: data: {"type":"stdout","data":"...","timestamp":...}
# Wait for: data: {"type":"exit","data":"0","timestamp":...}
```

### Recipe 4: Break Down a Large Beat

```bash
# Start AI breakdown
curl -X POST http://localhost:3000/api/breakdown \
  -H "Content-Type: application/json" \
  -d '{"parentBeatId": "large-beat", "_repo": "/path/to/repo"}'
# Response: { "data": { "id": "session-uuid", ... } }

# Stream until you receive a "plan" event
curl -N http://localhost:3000/api/breakdown/session-uuid

# Apply the plan to create sub-beats
curl -X POST http://localhost:3000/api/breakdown/apply \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-uuid", "_repo": "/path/to/repo"}'
# Response: { "data": { "createdBeatIds": [...], "waveCount": 2 } }
```

### Recipe 5: Multi-Agent Orchestration

```bash
# Start orchestration planning
curl -X POST http://localhost:3000/api/orchestration \
  -H "Content-Type: application/json" \
  -d '{"_repo": "/path/to/repo", "objective": "Ship v2.0"}'
# Response: { "data": { "id": "session-uuid", ... } }

# Stream until "plan" event
curl -N http://localhost:3000/api/orchestration/session-uuid

# Apply the plan
curl -X POST http://localhost:3000/api/orchestration/apply \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-uuid", "_repo": "/path/to/repo"}'
```

### Recipe 6: Add Dependencies

```bash
# Make beat-B block beat-A (beat-A cannot start until beat-B is done)
curl -X POST http://localhost:3000/api/beats/beat-A/deps \
  -H "Content-Type: application/json" \
  -d '{"blocks": "beat-B", "_repo": "/path/to/repo"}'

# See updated wave plan
curl http://localhost:3000/api/waves?_repo=/path/to/repo
```

---

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Validation error | Check `error` and `details` fields for field-level issues |
| 404 | Beat or session not found | Verify the ID exists |
| 409 | Edit conflict | Resource conflict; retry after resolving |
| 500 | Server error | Unexpected failure; check server logs |
| 503 | Backend degraded | Some endpoints return cached data as fallback; check `cached` field |

Always check the response body for an `error` field, even on non-2xx responses. The error message is always a human-readable string.

---

## OpenAPI Spec

A machine-readable OpenAPI 3.1.0 specification is available at:

```
GET /api/openapi.json
```
