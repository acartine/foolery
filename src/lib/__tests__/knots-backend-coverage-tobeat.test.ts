/**
 * KnotsBackend coverage: toBeat edge cases, workflow cache,
 * update with state change, update parent error paths,
 * and classifyKnotsError variations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type MockEdge,
  store,
  resetStore,
  insertKnot,
  mockListProfiles,
  mockShowKnot,
  mockUpdateKnot,
  mockListEdges,
} from "./knots-backend-coverage-mocks";

vi.mock("@/lib/knots", async () => {
  const m = await import("./knots-backend-coverage-mocks");
  return m.buildMockModule();
});

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── Tests ───────────────────────────────────────────────────

describe("KnotsBackend: invariant and description mapping", () => {
  it("maps knot invariants to beat invariants", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "INV1",
      title: "Invariant mapping",
      invariants: [
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "must stay queued" },
      ],
    });

    const result = await backend.get("INV1");
    expect(result.ok).toBe(true);
    expect(result.data?.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);
  });

  it("normalizes mixed invariant payload shapes from knots output", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "INV2",
      title: "Invariant mixed payload",
      invariants: [
        { kind: "Scope", condition: "  src/lib  " },
        { kind: "Scope", condition: "src/lib" },
        "State: must stay queued",
        "State:   must stay queued   ",
        "invalid",
      ] as unknown as Array<{
        kind: "Scope" | "State";
        condition: string;
      }>,
    });

    const result = await backend.get("INV2");
    expect(result.ok).toBe(true);
    expect(result.data?.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);
  });

  it("uses body when description is missing", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "BD1",
      title: "Body only",
      description: null,
      body: "The body text",
    });

    const result = await backend.get("BD1");
    expect(result.ok).toBe(true);
    expect(result.data?.description).toBe("The body text");
  });

  it("maps knot aliases onto beat aliases", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AL1",
      title: "Alias mapping",
      aliases: [" aa57 ", "project-aa57", "aa57", "", "   "],
    });

    const result = await backend.get("AL1");
    expect(result.ok).toBe(true);
    expect(result.data?.aliases).toEqual([
      "aa57", "project-aa57",
    ]);
  });
});

describe("KnotsBackend: priority, tags, timestamps, and metadata", () => {
  it("normalizes invalid priority to 2", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP1", title: "Bad prio", priority: 99 });

    const result = await backend.get("NP1");
    expect(result.ok).toBe(true);
    expect(result.data?.priority).toBe(2);
  });

  it("normalizes null priority to 2", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP2", title: "Null prio", priority: null });

    const result = await backend.get("NP2");
    expect(result.ok).toBe(true);
    expect(result.data?.priority).toBe(2);
  });

  it("preserves valid priorities 0-4", async () => {
    const backend = new KnotsBackend("/repo");
    for (const p of [0, 1, 2, 3, 4]) {
      insertKnot({
        id: `VP${p}`, title: `Prio ${p}`, priority: p,
      });
    }

    for (const p of [0, 1, 2, 3, 4]) {
      const result = await backend.get(`VP${p}`);
      expect(result.ok).toBe(true);
      expect(result.data?.priority).toBe(p);
    }
  });

  it("sets closed timestamp for terminal states", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "TS1", title: "Shipped", state: "shipped" });

    const result = await backend.get("TS1");
    expect(result.ok).toBe(true);
    expect(result.data?.closed).toBeDefined();
  });

  it("filters out invalid tags", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "FT1",
      title: "Tags",
      tags: ["valid", "", "  ", "also-valid"],
    });

    const result = await backend.get("FT1");
    expect(result.ok).toBe(true);
    expect(result.data?.labels).toContain("valid");
    expect(result.data?.labels).toContain("also-valid");
    expect(result.data?.labels).not.toContain("");
  });

  it("includes knotsHandoffCapsules, knotsNotes, and knotsSteps in metadata", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "MD1",
      title: "Metadata",
      notes: [{
        content: "note1", username: "u", datetime: "",
      }],
      handoff_capsules: [{ content: "capsule1" }],
      steps: [{
        content:
          "implementation -> ready_for_implementation_review",
        agentname: "codex",
      }],
    });

    const result = await backend.get("MD1");
    expect(result.ok).toBe(true);
    const meta = result.data?.metadata as Record<string, unknown>;
    expect(meta?.knotsHandoffCapsules).toEqual([
      { content: "capsule1" },
    ]);
    expect(Array.isArray(meta?.knotsNotes)).toBe(true);
    expect(meta?.knotsSteps).toEqual([{
      content:
        "implementation -> ready_for_implementation_review",
      agentname: "codex",
    }]);
  });
});

describe("KnotsBackend coverage: workflow cache", () => {
  it("caches workflow descriptors between calls", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "WC1", title: "Test" });

    await backend.list();
    await backend.list();

    expect(mockListProfiles).toHaveBeenCalledTimes(1);
  });
});

describe("KnotsBackend: state normalization and field updates", () => {
  it("normalizes state via workflow when updating", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "US1", title: "State update" });

    const result = await backend.update(
      "US1", { state: "implementation" },
    );
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]?.status).toBeDefined();
  });

  it("returns error when get fails during update", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.update(
      "MISSING-1", { title: "nope" },
    );
    expect(result.ok).toBe(false);
  });

  it("updates title, description, priority, type together", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "MU1", title: "Multi update" });

    const result = await backend.update("MU1", {
      title: "New title",
      description: "New desc",
      priority: 1,
      type: "bug",
    });
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]).toMatchObject({
      title: "New title",
      description: "New desc",
      priority: 1,
      type: "bug",
    });
  });

  it("adds and removes labels in update", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "LU1", title: "Label update", tags: ["old-tag"],
    });

    const result = await backend.update("LU1", {
      labels: ["new-tag"],
      removeLabels: ["old-tag"],
    });
    expect(result.ok).toBe(true);

    const calls = mockUpdateKnot.mock.calls;
    const patchCall = calls.find(
      (c) =>
        Array.isArray(c[1]?.addTags) ||
        Array.isArray(c[1]?.removeTags),
    );
    expect(patchCall?.[1]?.addTags).toEqual(["new-tag"]);
    expect(patchCall?.[1]?.removeTags).toEqual(["old-tag"]);
  });

  it("adds notes in update", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NU1", title: "Note update" });

    const result = await backend.update(
      "NU1", { notes: "A new note" },
    );
    expect(result.ok).toBe(true);

    const calls = mockUpdateKnot.mock.calls;
    const noteCall = calls.find(
      (c) => c[1]?.addNote === "A new note",
    );
    expect(noteCall).toBeDefined();
  });
});

describe("KnotsBackend: invariant and no-op updates", () => {
  it("serializes invariant add/remove/clear updates", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "IU1",
      title: "Invariant update",
      invariants: [
        { kind: "State", condition: "must stay queued" },
      ],
    });

    const result = await backend.update("IU1", {
      addInvariants: [
        { kind: "Scope", condition: "src/lib" },
      ],
      removeInvariants: [
        { kind: "State", condition: "must stay queued" },
      ],
      clearInvariants: true,
    });
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]).toMatchObject({
      addInvariants: ["Scope:src/lib"],
      removeInvariants: ["State:must stay queued"],
      clearInvariants: true,
    });
  });

  it("normalizes invariant mutation payloads before knots update", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "IU2",
      title: "Invariant update normalize",
      invariants: [
        { kind: "State", condition: "must stay queued" },
      ],
    });

    const result = await backend.update("IU2", {
      addInvariants: [
        { kind: "Scope", condition: " src/lib " },
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "   " },
      ],
      removeInvariants: [
        { kind: "State", condition: " must stay queued " },
        { kind: "State", condition: "must stay queued" },
      ],
    });
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]).toMatchObject({
      addInvariants: ["Scope:src/lib"],
      removeInvariants: ["State:must stay queued"],
    });
  });

  it("skips updateKnot when no patch fields set", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP1", title: "No patch" });

    const result = await backend.update("NP1", {});
    expect(result.ok).toBe(true);

    const directPatchCalls = mockUpdateKnot.mock.calls.filter(
      (c) =>
        c[0] === "NP1" &&
        (c[1]?.title !== undefined ||
          c[1]?.description !== undefined ||
          c[1]?.priority !== undefined ||
          c[1]?.status !== undefined ||
          c[1]?.type !== undefined ||
          c[1]?.addTags !== undefined ||
          c[1]?.removeTags !== undefined ||
          c[1]?.addNote !== undefined),
    );
    expect(directPatchCalls.length).toBe(0);
  });
});

describe("KnotsBackend coverage: update parent error paths", () => {
  it("propagates error when listing incoming edges fails", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PE1", title: "Parent error" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListEdges as any).mockImplementation(
      async (
        _id: string,
        direction?: "incoming" | "outgoing" | "both",
      ) => {
        if (direction === "incoming") {
          return {
            ok: false as const,
            error: "edge lookup failed",
          };
        }
        return { ok: true as const, data: [] };
      },
    );

    const result = await backend.update(
      "PE1", { parent: "NEW-PARENT" },
    );
    expect(result.ok).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListEdges as any).mockImplementation(
      async (
        id: string,
        direction?: "incoming" | "outgoing" | "both",
      ) => {
        const dir = direction ?? "both";
        const edges = store.edges.filter(
          (edge: MockEdge) => {
            if (dir === "incoming") return edge.dst === id;
            if (dir === "outgoing") return edge.src === id;
            return edge.src === id || edge.dst === id;
          },
        );
        return { ok: true as const, data: edges };
      },
    );
  });
});

describe("KnotsBackend coverage: classifyKnotsError variations", () => {
  it("classifies rate limit error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "rate limit exceeded",
    });

    const result = await backend.get("RL1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("RATE_LIMITED");
  });

  it("classifies unavailable error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "service unavailable",
    });

    const result = await backend.get("UA1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
  });

  it("classifies permission denied error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "permission denied for resource",
    });

    const result = await backend.get("PD1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PERMISSION_DENIED");
  });

  it("classifies locked/busy error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "database is busy",
    });

    const result = await backend.get("LK1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LOCKED");
  });

  it("classifies timeout error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "operation timed out",
    });

    const result = await backend.get("TO1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TIMEOUT");
  });

  it("classifies already exists error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "resource already exists",
    });

    const result = await backend.get("AE1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ALREADY_EXISTS");
  });

  it("classifies invalid input error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "invalid parameter value",
    });

    const result = await backend.get("II1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("classifies unknown error as INTERNAL", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "something completely unexpected",
    });

    const result = await backend.get("UN1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INTERNAL");
  });
});
