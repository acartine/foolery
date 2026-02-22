/**
 * Backend Contract Test Harness
 *
 * Exports `runBackendContractTests` -- a reusable function that registers a
 * full Vitest `describe` block verifying any BackendPort implementation
 * against the behavioural contract.
 *
 * The bottom of this file self-tests the harness with MockBackendPort.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Bead } from "@/lib/types";
import type { BackendPort } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { BackendErrorCode } from "@/lib/backend-errors";
import type { CreateBeadInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Valid error codes -- used to assert error contract
// ---------------------------------------------------------------------------

const VALID_ERROR_CODES: BackendErrorCode[] = [
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "INVALID_INPUT",
  "LOCKED",
  "TIMEOUT",
  "UNAVAILABLE",
  "PERMISSION_DENIED",
  "INTERNAL",
  "CONFLICT",
  "RATE_LIMITED",
];

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function sampleCreateInput(
  overrides?: Partial<CreateBeadInput>,
): CreateBeadInput {
  return {
    title: "Contract test bead",
    type: "task",
    priority: 2,
    labels: ["contract-test"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ContractTestFactory {
  port: BackendPort;
  capabilities: BackendCapabilities;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Section: Read operations (always tested)
// ---------------------------------------------------------------------------

function registerReadTests(
  getPort: () => BackendPort,
  getCaps: () => BackendCapabilities,
): void {
  describe("read operations", () => {
    it("list() returns ok:true with an array", async () => {
      const result = await getPort().list();
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("list() data items have required Bead fields", async () => {
      if (getCaps().canCreate) {
        await getPort().create(sampleCreateInput());
      }
      const result = await getPort().list();
      expect(result.ok).toBe(true);
      for (const bead of result.data ?? []) {
        expect(bead).toHaveProperty("id");
        expect(bead).toHaveProperty("title");
        expect(bead).toHaveProperty("type");
        expect(bead).toHaveProperty("status");
        expect(bead).toHaveProperty("priority");
        expect(bead).toHaveProperty("labels");
        expect(bead).toHaveProperty("created");
        expect(bead).toHaveProperty("updated");
      }
    });

    it("get() with valid ID returns ok:true", async () => {
      if (!getCaps().canCreate) return;
      const created = await getPort().create(sampleCreateInput());
      expect(created.ok).toBe(true);

      const result = await getPort().get(created.data!.id);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe(created.data!.id);
    });

    it("get() with invalid ID returns NOT_FOUND", async () => {
      const result = await getPort().get("nonexistent-id-999");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });
}

// ---------------------------------------------------------------------------
// Section: Write operations (skip if !canCreate)
// ---------------------------------------------------------------------------

function registerWriteTests(
  getPort: () => BackendPort,
  getCaps: () => BackendCapabilities,
): void {
  describe.skipIf(!getCaps().canCreate)("write operations", () => {
    it("create() returns ok:true with an id", async () => {
      const result = await getPort().create(sampleCreateInput());
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(typeof result.data!.id).toBe("string");
      expect(result.data!.id.length).toBeGreaterThan(0);
    });

    it("create() then get() returns the created bead", async () => {
      const input = sampleCreateInput({ title: "Roundtrip test" });
      const created = await getPort().create(input);
      expect(created.ok).toBe(true);

      const fetched = await getPort().get(created.data!.id);
      expect(fetched.ok).toBe(true);
      expect(fetched.data!.title).toBe("Roundtrip test");
      expect(fetched.data!.type).toBe("task");
    });

    it("update() changes the bead fields", async () => {
      const created = await getPort().create(sampleCreateInput());
      const id = created.data!.id;

      const updateResult = await getPort().update(id, {
        title: "Updated title",
        priority: 1,
      });
      expect(updateResult.ok).toBe(true);

      const fetched = await getPort().get(id);
      expect(fetched.ok).toBe(true);
      expect(fetched.data!.title).toBe("Updated title");
      expect(fetched.data!.priority).toBe(1);
    });

    it("close() sets status to closed", async () => {
      if (!getCaps().canClose) return;
      const created = await getPort().create(sampleCreateInput());
      const id = created.data!.id;

      const closeResult = await getPort().close(id, "done");
      expect(closeResult.ok).toBe(true);

      const fetched = await getPort().get(id);
      expect(fetched.ok).toBe(true);
      expect(fetched.data!.status).toBe("closed");
    });
  });
}

// ---------------------------------------------------------------------------
// Section: Delete operations (skip if !canDelete)
// ---------------------------------------------------------------------------

function registerDeleteTests(
  getPort: () => BackendPort,
  getCaps: () => BackendCapabilities,
): void {
  describe.skipIf(!getCaps().canDelete)("delete operations", () => {
    it("delete() removes the bead", async () => {
      if (!getCaps().canCreate) return;
      const created = await getPort().create(sampleCreateInput());
      const deleteResult = await getPort().delete(created.data!.id);
      expect(deleteResult.ok).toBe(true);
    });

    it("get() after delete() returns NOT_FOUND", async () => {
      if (!getCaps().canCreate) return;
      const created = await getPort().create(sampleCreateInput());
      const id = created.data!.id;

      await getPort().delete(id);
      const result = await getPort().get(id);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });
}

// ---------------------------------------------------------------------------
// Section: Search & Query (skip if !canSearch / !canQuery)
// ---------------------------------------------------------------------------

function registerSearchQueryTests(
  getPort: () => BackendPort,
  getCaps: () => BackendCapabilities,
): void {
  describe.skipIf(!getCaps().canSearch)("search operations", () => {
    it("search() returns matching results", async () => {
      if (!getCaps().canCreate) return;
      await getPort().create(
        sampleCreateInput({ title: "Unique needle alpha" }),
      );
      await getPort().create(sampleCreateInput({ title: "Other bead" }));

      const result = await getPort().search("needle alpha");
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data!.some((b: Bead) => b.title.includes("needle")),
      ).toBe(true);
    });
  });

  describe.skipIf(!getCaps().canQuery)("query operations", () => {
    it("query() returns results matching expression", async () => {
      if (!getCaps().canCreate) return;
      await getPort().create(sampleCreateInput({ title: "Query target" }));

      const result = await getPort().query("type:task");
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(1);
      expect(result.data!.every((b: Bead) => b.type === "task")).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Section: Dependencies (skip if !canManageDependencies)
// ---------------------------------------------------------------------------

function registerDependencyTests(
  getPort: () => BackendPort,
  getCaps: () => BackendCapabilities,
): void {
  describe.skipIf(!getCaps().canManageDependencies)(
    "dependency operations",
    () => {
      it("addDependency() creates a dependency", async () => {
        if (!getCaps().canCreate) return;
        const a = await getPort().create(
          sampleCreateInput({ title: "Blocker" }),
        );
        const b = await getPort().create(
          sampleCreateInput({ title: "Blocked" }),
        );
        const result = await getPort().addDependency(
          a.data!.id,
          b.data!.id,
        );
        expect(result.ok).toBe(true);
      });

      it("listDependencies() returns the added dependency", async () => {
        if (!getCaps().canCreate) return;
        const a = await getPort().create(
          sampleCreateInput({ title: "Blocker" }),
        );
        const b = await getPort().create(
          sampleCreateInput({ title: "Blocked" }),
        );
        await getPort().addDependency(a.data!.id, b.data!.id);

        const result = await getPort().listDependencies(a.data!.id);
        expect(result.ok).toBe(true);
        expect(result.data!.length).toBeGreaterThanOrEqual(1);
      });

      it("removeDependency() removes the dependency", async () => {
        if (!getCaps().canCreate) return;
        const a = await getPort().create(
          sampleCreateInput({ title: "Blocker" }),
        );
        const b = await getPort().create(
          sampleCreateInput({ title: "Blocked" }),
        );
        await getPort().addDependency(a.data!.id, b.data!.id);

        const removeResult = await getPort().removeDependency(
          a.data!.id,
          b.data!.id,
        );
        expect(removeResult.ok).toBe(true);

        const deps = await getPort().listDependencies(a.data!.id);
        expect(deps.ok).toBe(true);
        expect(deps.data!.length).toBe(0);
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Section: Error contract
// ---------------------------------------------------------------------------

function registerErrorContractTests(getPort: () => BackendPort): void {
  describe("error contract", () => {
    it("error results have { ok, error.code, error.message, error.retryable }", async () => {
      const result = await getPort().get("nonexistent-id-999");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error!.code).toBe("string");
      expect(typeof result.error!.message).toBe("string");
      expect(typeof result.error!.retryable).toBe("boolean");
    });

    it("error codes are valid BackendErrorCode values", async () => {
      const result = await getPort().get("nonexistent-id-999");
      expect(result.ok).toBe(false);
      expect(VALID_ERROR_CODES).toContain(result.error!.code);
    });
  });
}

// ---------------------------------------------------------------------------
// Exported harness (orchestrates the section functions)
// ---------------------------------------------------------------------------

export function runBackendContractTests(
  name: string,
  factory: () => ContractTestFactory,
): void {
  describe(name, () => {
    let port: BackendPort;
    let caps: BackendCapabilities;
    let cleanup: () => Promise<void>;

    beforeEach(() => {
      const ctx = factory();
      port = ctx.port;
      caps = ctx.capabilities;
      cleanup = ctx.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    const getPort = () => port;
    const getCaps = () => caps;

    registerReadTests(getPort, getCaps);
    registerWriteTests(getPort, getCaps);
    registerDeleteTests(getPort, getCaps);
    registerSearchQueryTests(getPort, getCaps);
    registerDependencyTests(getPort, getCaps);
    registerErrorContractTests(getPort);
  });
}

// ---------------------------------------------------------------------------
// Self-test: prove the harness works with the mock implementation
// ---------------------------------------------------------------------------

import { MockBackendPort, FULL_CAPABILITIES } from "./mock-backend-port";

runBackendContractTests("MockBackendPort (self-test)", () => {
  const port = new MockBackendPort();
  return {
    port,
    capabilities: FULL_CAPABILITIES,
    cleanup: async () => {
      port.reset();
    },
  };
});
