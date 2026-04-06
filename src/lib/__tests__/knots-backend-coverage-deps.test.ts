/**
 * KnotsBackend coverage: listDependencies and buildTakePrompt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  store,
  resetStore,
  insertKnot,
  mockShowKnot,
  mockClaimKnot,
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

describe("KnotsBackend coverage: listDependencies parent_of edges", () => {
  it("returns parent_of dependencies for a parent knot", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "P1", title: "Parent" });
    insertKnot({ id: "C1", title: "Child" });
    store.edges.push({ src: "P1", kind: "parent_of", dst: "C1" });

    const result = await backend.listDependencies("P1");
    expect(result.ok).toBe(true);
    const parentDeps = result.data?.filter(
      (d) => d.dependency_type === "parent_of",
    );
    expect(parentDeps?.length).toBeGreaterThan(0);
    expect(parentDeps?.[0]?.id).toBe("C1");
    expect(parentDeps?.[0]?.source).toBe("P1");
    expect(parentDeps?.[0]?.target).toBe("C1");
  });

  it("returns parent_of dependencies for a child knot", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "P2", title: "Parent" });
    insertKnot({ id: "C2", title: "Child" });
    store.edges.push({ src: "P2", kind: "parent_of", dst: "C2" });

    const result = await backend.listDependencies("C2");
    expect(result.ok).toBe(true);
    const parentDeps = result.data?.filter(
      (d) => d.dependency_type === "parent_of",
    );
    expect(parentDeps?.length).toBeGreaterThan(0);
    expect(parentDeps?.[0]?.id).toBe("P2");
  });

  it("filters blocked_by dependencies by type option", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "A1", title: "A" });
    insertKnot({ id: "B1", title: "B" });
    insertKnot({ id: "C1", title: "C" });
    store.edges.push({ src: "A1", kind: "blocked_by", dst: "B1" });
    store.edges.push({ src: "A1", kind: "parent_of", dst: "C1" });

    const result = await backend.listDependencies(
      "A1", undefined, { type: "blocks" },
    );
    expect(result.ok).toBe(true);
    const blockDeps = result.data?.filter(
      (d) => d.dependency_type === "blocked_by",
    );
    expect(blockDeps?.length).toBe(1);
    const parentDeps = result.data?.filter(
      (d) => d.dependency_type === "parent_of",
    );
    expect(parentDeps?.length).toBe(1);
  });

  it("excludes blocked_by edges when type filter is not blocks", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "D1", title: "D" });
    insertKnot({ id: "E1", title: "E" });
    store.edges.push({ src: "D1", kind: "blocked_by", dst: "E1" });

    const result = await backend.listDependencies(
      "D1", undefined, { type: "parent-child" },
    );
    expect(result.ok).toBe(true);
    const blockDeps = result.data?.filter(
      (d) => d.dependency_type === "blocked_by",
    );
    expect(blockDeps?.length).toBe(0);
  });

  it("returns both blocked_by and parent_of dependencies", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "X1", title: "Main" });
    insertKnot({
      id: "X2", title: "Blocker", aliases: ["blocker-alias"],
    });
    insertKnot({ id: "X3", title: "Child" });
    store.edges.push({ src: "X1", kind: "blocked_by", dst: "X2" });
    store.edges.push({ src: "X1", kind: "parent_of", dst: "X3" });

    const result = await backend.listDependencies("X1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(2);
    expect(
      result.data?.find((dep) => dep.id === "X2")?.aliases,
    ).toEqual(["blocker-alias"]);
  });

  it("skips blocked_by edges where id is neither src nor dst", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "M1", title: "Main" });
    insertKnot({ id: "M2", title: "Other1" });
    insertKnot({ id: "M3", title: "Other2" });
    store.edges.push({ src: "M2", kind: "blocked_by", dst: "M3" });

    mockListEdges.mockImplementationOnce(async () => ({
      ok: true as const,
      data: [{ src: "M2", kind: "blocked_by", dst: "M3" }],
    }));

    const result = await backend.listDependencies("M1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(0);
  });
});

describe("KnotsBackend coverage: buildTakePrompt parent prompt", () => {
  it("returns parent prompt with child listing when isParent + childBeatIds", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PARENT-1", title: "Epic task", description: "Big task",
    });
    insertKnot({ id: "CHILD-A", title: "Child A" });
    insertKnot({ id: "CHILD-B", title: "Child B" });

    const result = await backend.buildTakePrompt("PARENT-1", {
      isParent: true,
      childBeatIds: ["CHILD-A", "CHILD-B"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(result.data?.prompt).toContain("Parent beat ID: PARENT-1");
    expect(result.data?.prompt).toContain("CHILD-A");
    expect(result.data?.prompt).toContain("CHILD-B");
    expect(result.data?.prompt).toContain("KNOTS CLAIM MODE");
    expect(result.data?.prompt).toContain("Open child beat IDs:");
    expect(result.data?.prompt).toContain(
      "treat each claim result as a single-step authorization",
    );
    expect(result.data?.prompt).toContain(
      "Each child claim authorizes exactly one workflow action.",
    );
    expect(result.data?.prompt).toContain(
      "Do not immediately re-claim the same child",
    );
    expect(result.data?.prompt).toContain(
      "run `kno next <id> --expected-state <currentState>"
      + " --actor-kind agent` once to return it to queue,"
      + " then stop work on that child.",
    );
    expect(result.data?.prompt).toContain(
      "If `kno claim` exits with a non-zero exit code"
      + " for a child, stop work on that child immediately.",
    );
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });

  it("includes title and description in parent prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PARENT-2",
      title: "My Epic",
      description: "Detailed desc",
    });

    const result = await backend.buildTakePrompt("PARENT-2", {
      isParent: true,
      childBeatIds: ["C-1"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Title: My Epic");
    expect(result.data?.prompt).toContain(
      "Description: Detailed desc",
    );
  });

  it("uses body when description is absent for parent prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PARENT-3",
      title: "Body Epic",
      description: null,
      body: "Body text here",
    });

    const result = await backend.buildTakePrompt("PARENT-3", {
      isParent: true,
      childBeatIds: ["C-2"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(
      "Description: Body text here",
    );
  });

  it("returns error when parent knot does not exist", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.buildTakePrompt("MISSING", {
      isParent: true,
      childBeatIds: ["C-3"],
    });

    expect(result.ok).toBe(false);
  });
});

describe("KnotsBackend coverage: buildTakePrompt single-beat mode", () => {
  it("falls through to single-beat show when isParent but empty childBeatIds", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SOLO-1", title: "Solo" });

    const result = await backend.buildTakePrompt("SOLO-1", {
      isParent: true,
      childBeatIds: [],
      knotsLeaseId: "test-lease",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(result.data?.prompt).toContain("KNOTS CLAIM MODE");
    expect(result.data?.prompt).toContain("kno claim");
    expect(mockShowKnot).toHaveBeenCalledWith(
      "SOLO-1", "/repo",
    );
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });

  it("falls through to single-beat show when isParent is false", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SOLO-2", title: "Solo 2" });

    const result = await backend.buildTakePrompt("SOLO-2", {
      isParent: false,
      childBeatIds: ["unused"],
      knotsLeaseId: "test-lease",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(result.data?.prompt).toContain("KNOTS CLAIM MODE");
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });

  it("returns error when showKnot fails for single-beat mode", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.buildTakePrompt("MISSING-SINGLE", {
      knotsLeaseId: "test-lease",
    });

    expect(result.ok).toBe(false);
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });

  it("includes title and description in single-beat prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "DETAIL-1",
      title: "My Task",
      description: "Do the thing",
    });

    const result = await backend.buildTakePrompt("DETAIL-1", {
      knotsLeaseId: "test-lease",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Beat ID: DETAIL-1");
    expect(result.data?.prompt).toContain("Title: My Task");
    expect(result.data?.prompt).toContain(
      "Description: Do the thing",
    );
    expect(result.data?.prompt).toContain("kno claim");
    expect(result.data?.prompt).toContain(
      "single-step authorization",
    );
    expect(result.data?.prompt).toContain(
      "Do not run `kno claim` again in this session",
    );
  });

  it("uses body when description is absent for single-beat prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "BODY-1",
      title: "Body Task",
      description: null,
      body: "Body text here",
    });

    const result = await backend.buildTakePrompt("BODY-1", {
      knotsLeaseId: "test-lease",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(
      "Description: Body text here",
    );
  });
});
