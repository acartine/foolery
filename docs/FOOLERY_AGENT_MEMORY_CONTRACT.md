# Foolery Agent Memory Contract

This tutorial defines how Foolery talks to an agent-memory backend (Beads today, others later) and shows exactly how to implement one.

## What This Contract Does

Foolery's UI, API routes, and orchestration logic call one backend contract instead of memory-manager-specific code.

Core source files:

- Contract: [src/lib/backend-port.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-port.ts)
- Error taxonomy: [src/lib/backend-errors.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-errors.ts)
- Capabilities: [src/lib/backend-capabilities.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-capabilities.ts)
- Factory wiring: [src/lib/backend-factory.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-factory.ts)
- Singleton access: [src/lib/backend-instance.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-instance.ts)

## 1. Implement the Core Interface (`BackendPort`)

Every backend must implement this interface.

```ts
export interface BackendPort {
  list(filters?: BeadListFilters, repoPath?: string): Promise<BackendResult<Bead[]>>;
  listReady(filters?: BeadListFilters, repoPath?: string): Promise<BackendResult<Bead[]>>;
  search(query: string, filters?: BeadListFilters, repoPath?: string): Promise<BackendResult<Bead[]>>;
  query(expression: string, options?: BeadQueryOptions, repoPath?: string): Promise<BackendResult<Bead[]>>;
  get(id: string, repoPath?: string): Promise<BackendResult<Bead>>;

  create(input: CreateBeadInput, repoPath?: string): Promise<BackendResult<{ id: string }>>;
  update(id: string, input: UpdateBeadInput, repoPath?: string): Promise<BackendResult<void>>;
  delete(id: string, repoPath?: string): Promise<BackendResult<void>>;
  close(id: string, reason?: string, repoPath?: string): Promise<BackendResult<void>>;

  listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeadDependency[]>>;
  addDependency(blockerId: string, blockedId: string, repoPath?: string): Promise<BackendResult<void>>;
  removeDependency(blockerId: string, blockedId: string, repoPath?: string): Promise<BackendResult<void>>;
}
```

Result envelope used by every method:

```ts
export interface BackendResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

## 2. Use the Standard Error + Retry Model

Use Foolery's canonical error codes from [src/lib/backend-errors.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-errors.ts).

```ts
export type BackendErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "INVALID_INPUT"
  | "LOCKED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "INTERNAL"
  | "CONFLICT"
  | "RATE_LIMITED";
```

`retryable` must align with `isRetryableByDefault(code)` unless your backend has a concrete reason to override it.

## 3. Declare Capabilities

Capabilities let callers degrade safely when a backend does not support a feature.

```ts
export interface BackendCapabilities {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canClose: boolean;
  canSearch: boolean;
  canQuery: boolean;
  canListReady: boolean;
  canManageDependencies: boolean;
  canManageLabels: boolean;
  canSync: boolean;
  maxConcurrency: number;
}
```

See presets and helpers in [src/lib/backend-capabilities.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-capabilities.ts).

## 4. Wire the Backend into the App

1. Add your backend type and constructor in [src/lib/backend-factory.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-factory.ts).
2. Ensure selection works through `FOOLERY_BACKEND` in [src/lib/backend-instance.ts](https://github.com/acartine/foolery/blob/main/src/lib/backend-instance.ts).
3. Keep callers using `getBackend()`; avoid direct backend imports in routes/components.

Factory pattern used today:

```ts
export type BackendType = "auto" | "cli" | "stub" | "beads" | "knots";

export function createBackend(type: BackendType = "auto"): BackendEntry {
  switch (type) {
    case "auto": {
      const backend = new AutoRoutingBackend("cli");
      return { port: backend, capabilities: FULL_CAPABILITIES };
    }
    case "cli": {
      const backend = new BdCliBackend();
      return { port: backend, capabilities: backend.capabilities };
    }
    case "stub": {
      const backend = new StubBackend();
      return { port: backend, capabilities: backend.capabilities };
    }
    case "beads": {
      const backend = new BeadsBackend();
      return { port: backend, capabilities: BEADS_CAPABILITIES };
    }
    case "knots": {
      const backend = new KnotsBackend();
      return { port: backend, capabilities: KNOTS_CAPABILITIES };
    }
  }
}
```

With `type: "auto"`, backend selection is resolved per repo by marker detection:
`.knots` routes to Knots, `.beads` routes to Beads/CLI, and `.knots` wins when both exist.

## 5. Implementation Example: `BeadsBackend` (JSONL)

Reference implementation:

- [src/lib/backends/beads-backend.ts](https://github.com/acartine/foolery/blob/main/src/lib/backends/beads-backend.ts)
- [src/lib/backends/knots-backend.ts](https://github.com/acartine/foolery/blob/main/src/lib/backends/knots-backend.ts)

Capability declaration:

```ts
export const BEADS_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canClose: true,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: true,
  canManageLabels: true,
  canSync: false,
  maxConcurrency: 1,
});
```

A concrete `listReady` implementation:

```ts
async listReady(
  filters?: BeadListFilters,
  repoPath?: string,
): Promise<BackendResult<Bead[]>> {
  const rp = this.resolvePath(repoPath);
  const entry = await this.ensureLoaded(rp);
  const blockedIds = new Set(entry.deps.map((d) => d.blockedId));
  let items = Array.from(entry.beads.values()).filter(
    (b) => b.status === "open" && !blockedIds.has(b.id),
  );
  items = applyFilters(items, filters);
  return { ok: true, data: items };
}
```

Dependency write path (`addDependency`):

```ts
async addDependency(
  blockerId: string,
  blockedId: string,
  repoPath?: string,
): Promise<BackendResult<void>> {
  const rp = this.resolvePath(repoPath);
  const entry = await this.ensureLoaded(rp);

  if (!entry.beads.has(blockerId)) {
    return backendError("NOT_FOUND", `Bead ${blockerId} not found`);
  }
  if (!entry.beads.has(blockedId)) {
    return backendError("NOT_FOUND", `Bead ${blockedId} not found`);
  }

  const exists = entry.deps.some(
    (d) => d.blockerId === blockerId && d.blockedId === blockedId,
  );
  if (exists) {
    return backendError(
      "ALREADY_EXISTS",
      `Dependency ${blockerId} -> ${blockedId} already exists`,
    );
  }

  entry.deps.push({ blockerId, blockedId });
  await this.flush(rp);
  return { ok: true };
}
```

Minimal usage example:

```ts
import { createBackend } from "@/lib/backend-factory";

const { port } = createBackend("beads");

const created = await port.create({
  title: "Ship memory contract docs",
  type: "task",
  priority: 2,
});

if (!created.ok) throw new Error(created.error?.message);

await port.addDependency("foolery-1", created.data!.id);
const ready = await port.listReady();
```

## 6. Register Memory Manager Metadata + Detection

If your backend maps to a discoverable repository memory manager, update:

- [src/lib/memory-managers.ts](https://github.com/acartine/foolery/blob/main/src/lib/memory-managers.ts)
- [src/lib/memory-manager-detection.ts](https://github.com/acartine/foolery/blob/main/src/lib/memory-manager-detection.ts)

Current memory manager metadata shape:

```ts
export interface MemoryManagerImplementation {
  type: MemoryManagerType;
  label: string;
  markerDirectory: string;
}
```

## 7. Validate with Contract Tests

Run the reusable contract harness against your backend:

- Harness: [src/lib/__tests__/backend-contract.test.ts](https://github.com/acartine/foolery/blob/main/src/lib/__tests__/backend-contract.test.ts)
- Beads example: [src/lib/__tests__/beads-backend-contract.test.ts](https://github.com/acartine/foolery/blob/main/src/lib/__tests__/beads-backend-contract.test.ts)

Example harness usage:

```ts
runBackendContractTests("BeadsBackend", () => {
  const port = new BeadsBackend(tempDir);
  return {
    port,
    capabilities: BEADS_CAPABILITIES,
    cleanup: async () => {
      port._reset();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
});
```

## 8. Quality Gates

Before shipping backend changes:

```bash
bun run lint
bunx tsc --noEmit
bun run test
bun run build
```

## Backend Author Checklist

- [ ] `BackendPort` fully implemented
- [ ] Error codes and retryability are standardized
- [ ] Capabilities declared accurately
- [ ] Factory + singleton wiring updated
- [ ] Memory manager detection/metadata updated (if needed)
- [ ] Contract test harness passes
- [ ] Full quality gates pass
