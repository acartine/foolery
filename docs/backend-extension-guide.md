# Backend Extension Guide

How to add a new backend implementation to Foolery.

## Overview

Foolery uses a **port-adapter pattern** to decouple business logic from storage.
All beat operations flow through a single `BackendPort` interface.  Concrete
implementations (CLI wrapper, direct JSONL I/O, in-memory stub) sit behind this
interface so the rest of the application never knows which backend is active.

This means you can add a new storage backend -- a REST API client, a SQLite
adapter, a cloud-hosted service -- without touching any UI, routing, or
orchestration code.

## Architecture

| File | Role |
|------|------|
| `src/lib/backend-port.ts` | The `BackendPort` interface and result types (`BackendResult<T>`, `BackendError`). This is the contract every backend must satisfy. |
| `src/lib/backend-capabilities.ts` | The `BackendCapabilities` type plus preset constants (`FULL_CAPABILITIES`, `READ_ONLY_CAPABILITIES`) and guard helpers (`assertCapability`, `hasCapability`). |
| `src/lib/backend-factory.ts` | Factory function `createBackend(type)` that maps a `BackendType` string to a concrete instance. You register new backends here. |
| `src/lib/backend-instance.ts` | Singleton accessor. Lazily creates the backend from `FOOLERY_BACKEND` env var and caches it for the process lifetime. |
| `src/lib/backend-errors.ts` | Error code taxonomy (`BackendErrorCode`), the `BackendError` class, factory helpers (`notFound`, `internal`, ...), and raw-string classification. |
| `src/lib/backends/` | Directory containing all backend implementations. |
| `src/lib/__tests__/backend-contract.test.ts` | Reusable contract test harness that validates any `BackendPort` implementation. |
| `src/lib/__tests__/mock-backend-port.ts` | In-memory mock used by unit tests and as the contract harness self-test target. |

## Step-by-step: add a new backend

### 1. Create the implementation file

Add a new file in `src/lib/backends/`. Follow the naming convention
`<name>-backend.ts`.

```
src/lib/backends/my-backend.ts
```

Your class must implement every method of `BackendPort`:

```ts
import type {
  BackendPort,
  BackendResult,
  BeatListFilters,
  BeatQueryOptions,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type { Beat, BeatDependency } from "@/lib/types";

export class MyBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = MY_CAPABILITIES;

  async list(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    // ...
  }

  async listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    // ...
  }

  async search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    // ...
  }

  async query(
    expression: string,
    options?: BeatQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    // ...
  }

  async get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Beat>> {
    // ...
  }

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    // ...
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    // ...
  }

  async delete(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    // ...
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    // ...
  }

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    // ...
  }

  async addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    // ...
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    // ...
  }
}
```

### 2. Define capabilities

Declare a `BackendCapabilities` constant that honestly reports what your backend
supports. The application uses these flags to skip UI controls and degrade
gracefully when a capability is missing.

```ts
export const MY_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canClose: true,
  canSearch: true,
  canQuery: false,       // set false if not supported
  canListReady: true,
  canManageDependencies: false,
  canManageLabels: true,
  canSync: false,
  maxConcurrency: 0,     // 0 = unlimited
});
```

**Capability flags:**

| Flag | Meaning |
|------|---------|
| `canCreate` | `create()` is functional |
| `canUpdate` | `update()` is functional |
| `canDelete` | `delete()` is functional |
| `canClose` | `close()` is functional |
| `canSearch` | `search()` does free-text matching |
| `canQuery` | `query()` handles structured expressions |
| `canListReady` | `listReady()` filters to unblocked beats |
| `canManageDependencies` | `addDependency` / `removeDependency` / `listDependencies` work |
| `canManageLabels` | Label add/remove through `update()` works |
| `canSync` | Backend supports a sync operation |
| `maxConcurrency` | Max parallel operations (0 = unlimited) |

Callers check capabilities with:

```ts
import { hasCapability, assertCapability } from "@/lib/backend-capabilities";

if (hasCapability(backend.capabilities, "canDelete")) {
  // safe to call backend.delete()
}

// Or throw if missing:
assertCapability(backend.capabilities, "canDelete", "delete beat");
```

### 3. Register in the factory

Edit `src/lib/backend-factory.ts`:

1. Import your backend class (and capabilities constant if needed).
2. Add your type string to the `BackendType` union.
3. Add a `case` in the `switch` statement.

```ts
// Add import
import { MyBackend, MY_CAPABILITIES } from "@/lib/backends/my-backend";

// Expand the union
export type BackendType = "auto" | "cli" | "stub" | "beads" | "knots" | "my-backend";

// Add case
case "my-backend": {
  const backend = new MyBackend();
  return { port: backend, capabilities: MY_CAPABILITIES };
}
```

The exhaustive `default` case (using `never`) will produce a compile error if
you add a new type string but forget the corresponding `case`.

### 4. Select with the environment variable

The singleton in `backend-instance.ts` reads `FOOLERY_BACKEND` to choose which
backend to create. Set it to your new type string:

```bash
FOOLERY_BACKEND=my-backend bun run dev
```

The default when unset is `"auto"` (per-repo memory manager auto-routing).

You can also configure the backend in the settings schema
(`src/lib/schemas.ts`) by adding your type to the `backendSettingsSchema` enum:

```ts
export const backendSettingsSchema = z
  .object({
    type: z.enum(["auto", "cli", "stub", "beads", "knots", "my-backend"]).default("auto"),
  })
  .default({ type: "auto" });
```

## Contract compliance

The project includes a reusable contract test harness at
`src/lib/__tests__/backend-contract.test.ts`. It automatically tests:

- **Read operations** -- `list()`, `get()`, field shape validation
- **Write operations** -- `create()`, `update()`, `close()` (skipped if `!canCreate`)
- **Delete operations** -- `delete()`, get-after-delete (skipped if `!canDelete`)
- **Search and query** -- `search()`, `query()` (skipped per capability)
- **Dependencies** -- add, list, remove (skipped if `!canManageDependencies`)
- **Error contract** -- error shape (`{ ok, error.code, error.message, error.retryable }`) and valid error codes

### Running the harness against your backend

Create a test file (e.g., `src/lib/__tests__/my-backend-contract.test.ts`):

```ts
import { runBackendContractTests } from "./backend-contract.test";
import { MyBackend, MY_CAPABILITIES } from "@/lib/backends/my-backend";

runBackendContractTests("MyBackend", () => {
  const backend = new MyBackend(/* test config */);
  return {
    port: backend,
    capabilities: MY_CAPABILITIES,
    cleanup: async () => {
      // Reset state between tests.
      // For in-memory backends, clear internal maps.
      // For file-backed backends, delete the temp files.
      // For remote backends, call a teardown endpoint.
    },
  };
});
```

The `ContractTestFactory` type requires three fields:

| Field | Type | Purpose |
|-------|------|---------|
| `port` | `BackendPort` | The backend instance under test |
| `capabilities` | `BackendCapabilities` | Used to skip test sections that do not apply |
| `cleanup` | `() => Promise<void>` | Called in `afterEach` to reset state between tests |

Run with:

```bash
bun run test src/lib/__tests__/my-backend-contract.test.ts
```

Or run the full suite to make sure nothing is broken:

```bash
bun run test
```

## Error handling

Every `BackendPort` method returns `BackendResult<T>` instead of throwing:

```ts
interface BackendResult<T> {
  ok: boolean;
  data?: T;           // present when ok === true
  error?: BackendError; // present when ok === false
}

interface BackendError {
  code: string;        // machine-readable BackendErrorCode
  message: string;     // human-readable description
  retryable: boolean;  // whether the caller may retry
}
```

### Error codes

Use the codes defined in `src/lib/backend-errors.ts`:

| Code | Retryable | When to use |
|------|-----------|-------------|
| `NOT_FOUND` | No | Resource does not exist |
| `ALREADY_EXISTS` | No | Duplicate create or duplicate dependency |
| `INVALID_INPUT` | No | Validation failure on caller-provided data |
| `LOCKED` | Yes | Resource is temporarily locked by another process |
| `TIMEOUT` | Yes | Operation exceeded time limit |
| `UNAVAILABLE` | Yes | Backend is down or unreachable |
| `PERMISSION_DENIED` | No | Caller lacks authorization |
| `INTERNAL` | No | Unexpected bug in the backend |
| `CONFLICT` | No | Concurrent modification conflict |
| `RATE_LIMITED` | Yes | Too many requests |

### Building error results

Option A -- Inline result objects (simple, no dependencies):

```ts
function backendError(
  code: BackendErrorCode,
  message: string,
): BackendResult<never> {
  return {
    ok: false,
    error: { code, message, retryable: isRetryableByDefault(code) },
  };
}
```

Option B -- Use the factory helpers from `backend-errors.ts`:

```ts
import { notFound, internal, unavailable } from "@/lib/backend-errors";

// These return BackendError instances (class, not plain objects).
// Wrap them into a BackendResult when returning from port methods:
return {
  ok: false,
  error: {
    code: notFound(id).code,
    message: notFound(id).message,
    retryable: notFound(id).retryable,
  },
};
```

Option C -- Classify raw error strings (useful when wrapping a CLI or HTTP
response that gives you unstructured error text):

```ts
import {
  classifyErrorMessage,
  isRetryableByDefault,
} from "@/lib/backend-errors";

const code = classifyErrorMessage(rawErrorString);
return {
  ok: false,
  error: {
    code,
    message: rawErrorString,
    retryable: isRetryableByDefault(code),
  },
};
```

The `BdCliBackend` uses this pattern via its `toBR()` helper.

## Testing

### Mock backend for unit tests

`src/lib/__tests__/mock-backend-port.ts` exports `MockBackendPort` -- a
full-featured in-memory implementation. Use it in unit tests for components or
services that depend on `BackendPort`:

```ts
import { MockBackendPort } from "@/lib/__tests__/mock-backend-port";

const backend = new MockBackendPort();
// seed data
await backend.create({ title: "Test beat", type: "task", priority: 2 });
// use in your component/service under test
// ...
// reset between tests
backend.reset();
```

### Stub backend for safe defaults

`StubBackend` returns empty arrays for reads and `UNAVAILABLE` errors for
writes. It is useful as a no-op fallback during incremental migration or when
the real backend is not yet configured.

### Contract tests

As described above, `runBackendContractTests` exercises the full behavioral
surface of any `BackendPort`. Use it to validate your implementation against the
shared contract. The harness automatically skips test sections based on your
declared capabilities, so a read-only backend will not fail write tests.

### Testing pattern summary

| Need | Tool |
|------|------|
| Unit test a component that calls BackendPort | `MockBackendPort` |
| Validate a new backend satisfies the contract | `runBackendContractTests` |
| Safe no-op backend during development | `StubBackend` |
| Reference implementation to copy from | `MockBackendPort` or `BeadsBackend` |

## Checklist

Before considering your backend complete:

- [ ] Class implements `BackendPort` (all 12 methods)
- [ ] Capabilities constant is defined and accurate
- [ ] Factory case added in `backend-factory.ts`
- [ ] Type string added to `BackendType` union
- [ ] Type string added to `backendSettingsSchema` enum (if user-selectable)
- [ ] Contract test file created and passing
- [ ] Error results use valid `BackendErrorCode` values
- [ ] Error results set `retryable` correctly
- [ ] `cleanup` in contract test resets state fully between tests
- [ ] `bun run lint && bunx tsc --noEmit && bun run test && bun run build` all pass
