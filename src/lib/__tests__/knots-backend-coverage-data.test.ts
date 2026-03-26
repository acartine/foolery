/**
 * KnotsBackend coverage: notes/metadata, acceptance read paths,
 * create with extra fields, applyFilters edge cases,
 * and query matchExpression fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetStore,
  insertKnot,
  mockListProfiles,
  mockUpdateKnot,
  mockNewKnot,
  mockAddEdge,
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

describe("KnotsBackend coverage: knot with notes and metadata", () => {
  it("stringifies notes with datetime prefix", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "N1",
      title: "With notes",
      notes: [
        {
          content: "First note",
          username: "alice",
          datetime: "2026-01-01",
        },
        { content: "Second note", username: "bob", datetime: "" },
      ],
    });

    const result = await backend.get("N1");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toContain(
      "[2026-01-01] alice: First note",
    );
    expect(result.data?.notes).toContain("bob: Second note");
  });

  it("returns undefined notes when notes array is empty", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "N2", title: "No notes", notes: [] });

    const result = await backend.get("N2");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toBeUndefined();
  });

  it("handles notes with invalid entries", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "N3",
      title: "Bad notes",
      notes: [
        null as unknown as Record<string, unknown>,
        { content: "", username: "alice" },
        {
          content: "Valid",
          username: "bob",
          datetime: "2026-01-01",
        },
      ],
    });

    const result = await backend.get("N3");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toContain("bob: Valid");
  });
});

describe("KnotsBackend coverage: acceptance read paths", () => {
  it("reads acceptance from the native knot field", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-NATIVE1",
      title: "Native acceptance",
      acceptance: "Native criteria",
      notes: [{
        content: "Regular note",
        username: "alice",
        datetime: "2026-01-01",
      }],
    });

    const result = await backend.get("AC-NATIVE1");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBe("Native criteria");
  });

  it("extracts acceptance from tagged notes into beat.acceptance", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-RT1",
      title: "Acceptance round-trip",
      notes: [
        {
          content: "Regular note",
          username: "alice",
          datetime: "2026-01-01",
        },
        {
          content: "Acceptance Criteria:\nMust pass all tests",
          username: "system",
          datetime: "2026-01-02",
        },
      ],
    });

    const result = await backend.get("AC-RT1");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBe("Must pass all tests");
  });

  it("prefers native acceptance over note fallback when both exist", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-NATIVE2",
      title: "Acceptance precedence",
      acceptance: "Native criteria",
      notes: [{
        content: "Acceptance Criteria:\nLegacy criteria",
        username: "system",
        datetime: "2026-01-02",
      }],
    });

    const result = await backend.get("AC-NATIVE2");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBe("Native criteria");
  });

  it("excludes acceptance-marker notes from visible beat.notes", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-RT2",
      title: "Acceptance hidden from notes",
      notes: [
        {
          content: "Regular note",
          username: "alice",
          datetime: "2026-01-01",
        },
        {
          content: "Acceptance Criteria:\nMust pass all tests",
          username: "system",
          datetime: "2026-01-02",
        },
      ],
    });

    const result = await backend.get("AC-RT2");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toContain("alice: Regular note");
    expect(result.data?.notes).not.toContain(
      "Acceptance Criteria",
    );
  });

  it("uses the latest acceptance note when multiple exist", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-RT3",
      title: "Multiple acceptance notes",
      notes: [
        {
          content: "Acceptance Criteria:\nOld criteria",
          username: "system",
          datetime: "2026-01-01",
        },
        {
          content: "Some regular note",
          username: "bob",
          datetime: "2026-01-02",
        },
        {
          content: "Acceptance Criteria:\nUpdated criteria",
          username: "system",
          datetime: "2026-01-03",
        },
      ],
    });

    const result = await backend.get("AC-RT3");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBe("Updated criteria");
    expect(result.data?.notes).not.toContain(
      "Acceptance Criteria",
    );
    expect(result.data?.notes).toContain(
      "bob: Some regular note",
    );
  });

  it("returns undefined acceptance when no acceptance notes exist", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-RT4",
      title: "No acceptance",
      notes: [{
        content: "Just a note",
        username: "alice",
        datetime: "2026-01-01",
      }],
    });

    const result = await backend.get("AC-RT4");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBeUndefined();
  });

  it("returns undefined acceptance when acceptance note body is empty", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-RT5",
      title: "Empty acceptance",
      notes: [{
        content: "Acceptance Criteria:\n",
        username: "system",
        datetime: "2026-01-01",
      }],
    });

    const result = await backend.get("AC-RT5");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBeUndefined();
  });

  it("falls back to legacy notes when acceptance is null", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-NULL1",
      title: "Null acceptance with legacy note",
      acceptance: null,
      notes: [{
        content: "Acceptance Criteria:\nLegacy criteria from note",
        username: "system",
        datetime: "2026-01-01",
      }],
    });

    const result = await backend.get("AC-NULL1");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBe(
      "Legacy criteria from note",
    );
  });

  it("returns undefined when acceptance is null and no legacy notes exist", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AC-NULL2",
      title: "Null acceptance no notes",
      acceptance: null,
      notes: [{
        content: "Regular note",
        username: "alice",
        datetime: "2026-01-01",
      }],
    });

    const result = await backend.get("AC-NULL2");
    expect(result.ok).toBe(true);
    expect(result.data?.acceptance).toBeUndefined();
  });
});

describe("KnotsBackend coverage: create with extra fields", () => {
  it("creates with priority, type, labels, notes, acceptance, and parent", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "CPARENT", title: "Parent" });

    const result = await backend.create({
      title: "Full create",
      type: "bug",
      priority: 1,
      labels: ["urgent", "frontend"],
      notes: "Implementation note",
      acceptance: "All tests pass",
      parent: "CPARENT",
    });

    expect(result.ok).toBe(true);
    const updateCalls = mockUpdateKnot.mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(mockNewKnot).toHaveBeenCalledWith(
      "Full create",
      expect.objectContaining({ acceptance: "All tests pass" }),
      "/repo",
    );
    expect(mockAddEdge).toHaveBeenCalled();
  });

  it("serializes create invariants as knots addInvariants patch", async () => {
    const backend = new KnotsBackend("/repo");

    const result = await backend.create({
      title: "Invariant create",
      type: "task",
      priority: 2,
      labels: [],
      invariants: [
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "must stay queued" },
      ],
    });

    expect(result.ok).toBe(true);
    const patchCall = mockUpdateKnot.mock.calls.find(
      (c) => Array.isArray(c[1]?.addInvariants),
    );
    expect(patchCall?.[1]?.addInvariants).toEqual([
      "Scope:src/lib",
      "State:must stay queued",
    ]);
  });

  it("normalizes create invariants before serializing knots patch", async () => {
    const backend = new KnotsBackend("/repo");

    const result = await backend.create({
      title: "Invariant normalization",
      type: "task",
      priority: 2,
      labels: [],
      invariants: [
        { kind: "Scope", condition: " src/lib " },
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "  " },
      ],
    });

    expect(result.ok).toBe(true);
    const patchCall = mockUpdateKnot.mock.calls.find(
      (c) => Array.isArray(c[1]?.addInvariants),
    );
    expect(patchCall?.[1]?.addInvariants).toEqual([
      "Scope:src/lib",
    ]);
  });

  it("returns error when profiles are empty", async () => {
    mockListProfiles.mockResolvedValueOnce({
      ok: true as const,
      data: [],
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.create({
      title: "No profiles",
      type: "task",
      priority: 2,
      labels: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

describe("KnotsBackend coverage: applyFilters edge cases", () => {
  it("filters by queued state", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "AF1", title: "Queued", state: "ready_for_planning",
    });
    insertKnot({
      id: "AF2", title: "Active", state: "planning",
    });

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);
    expect(
      result.data?.every((b) => b.id === "AF1"),
    ).toBe(true);
  });

  it("filters by in_action state", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "FA1", title: "Active", state: "implementation",
    });
    insertKnot({
      id: "FA2",
      title: "Queued",
      state: "ready_for_implementation",
    });

    const result = await backend.list({ state: "in_action" });
    expect(result.ok).toBe(true);
    expect(
      result.data?.every((b) => b.id === "FA1"),
    ).toBe(true);
  });

  it("filters by exact state", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "ES1", title: "Shipped", state: "shipped",
    });
    insertKnot({
      id: "ES2", title: "Planning", state: "planning",
    });

    const result = await backend.list({ state: "shipped" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("ES1");
  });

  it("filters by label", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "LB1", title: "Tagged", tags: ["urgent"],
    });
    insertKnot({ id: "LB2", title: "Not tagged" });

    const result = await backend.list({ label: "urgent" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("LB1");
  });

  it("filters by priority", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PR1", title: "High", priority: 1 });
    insertKnot({ id: "PR2", title: "Low", priority: 3 });

    const result = await backend.list({ priority: 1 });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("PR1");
  });
});

describe("KnotsBackend coverage: query matchExpression fields", () => {
  it("matches on workflow/workflowid", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "QW1", title: "W1", profile_id: "autopilot",
    });

    const result = await backend.query("workflowid:autopilot");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on profile/profileid", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "QP1", title: "P1", profile_id: "autopilot",
    });

    const result = await backend.query("profileid:autopilot");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on id field", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QID1", title: "ID match" });

    const result = await backend.query("id:QID1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on label", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "QL1", title: "Labeled", tags: ["bugfix"],
    });

    const result = await backend.query("label:bugfix");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("ignores unknown field in expression", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QU1", title: "Unknown field" });

    const result = await backend.query("unknown:value");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("ignores terms without colon separator", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QNC1", title: "No colon" });

    const result = await backend.query("nocolon");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });
});
