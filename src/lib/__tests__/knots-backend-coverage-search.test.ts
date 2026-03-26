/**
 * KnotsBackend coverage: search, query, listReady,
 * update with parent, and removeDependency.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  store,
  resetStore,
  insertKnot,
  nowIso,
  mockListProfiles,
  mockUpdateKnot,
  mockSetKnotProfile,
  mockRemoveEdge,
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

describe("KnotsBackend coverage: search and query", () => {
  it("search matches on id, aliases, title, description, and notes", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "foolery-1789",
      title: "Alpha",
      aliases: ["search-1789"],
      description: "beta search target",
      notes: [{
        content: "gamma note", username: "u", datetime: nowIso(),
      }],
    });
    insertKnot({ id: "S2", title: "Unrelated" });

    const byFullId = await backend.search("foolery-1789");
    expect(byFullId.ok).toBe(true);
    expect(byFullId.data?.length).toBe(1);
    expect(byFullId.data?.[0]?.id).toBe("foolery-1789");

    const bySuffix = await backend.search("1789");
    expect(bySuffix.ok).toBe(true);
    expect(bySuffix.data?.length).toBe(1);
    expect(bySuffix.data?.[0]?.id).toBe("foolery-1789");

    const byAlias = await backend.search("search-1789");
    expect(byAlias.ok).toBe(true);
    expect(byAlias.data?.length).toBe(1);
    expect(byAlias.data?.[0]?.id).toBe("foolery-1789");

    const byDesc = await backend.search("beta");
    expect(byDesc.ok).toBe(true);
    expect(byDesc.data?.length).toBe(1);
    expect(byDesc.data?.[0]?.id).toBe("foolery-1789");

    const byNotes = await backend.search("gamma");
    expect(byNotes.ok).toBe(true);
    expect(byNotes.data?.length).toBe(1);
  });

  it("search applies filters to matched results", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SF1", title: "Match one", type: "task" });
    insertKnot({ id: "SF2", title: "Match two", type: "bug" });

    const result = await backend.search("Match", { type: "task" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("SF1");
  });

  it("query matches on expression fields", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "Q1", title: "Query target", type: "bug", priority: 1,
    });
    insertKnot({ id: "Q2", title: "Other", type: "task" });

    const byType = await backend.query("type:bug");
    expect(byType.ok).toBe(true);
    expect(byType.data?.length).toBe(1);
    expect(byType.data?.[0]?.id).toBe("Q1");
  });

  it("query supports multiple expression terms", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "QM1", title: "Multi", type: "task", priority: 1,
    });
    insertKnot({
      id: "QM2", title: "Other", type: "task", priority: 3,
    });

    const result = await backend.query("type:task priority:1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("QM1");
  });

  it("query returns error when buildBeats fails", async () => {
    mockListProfiles.mockResolvedValueOnce({
      ok: false as const,
      error: "profiles unavailable",
    } as never);

    const backend = new KnotsBackend("/repo");
    const result = await backend.query("type:task");
    expect(result.ok).toBe(false);
  });
});

describe("KnotsBackend coverage: listReady with blocking edges", () => {
  it("excludes blocked knots from listReady", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "R1", title: "Ready", state: "ready_for_implementation",
    });
    insertKnot({
      id: "R2", title: "Blocked", state: "ready_for_implementation",
    });
    insertKnot({
      id: "R3", title: "Blocker", state: "implementation",
    });
    store.edges.push({ src: "R2", kind: "blocked_by", dst: "R3" });

    const listed = await backend.list();
    expect(listed.ok).toBe(true);

    const ready = await backend.listReady();
    expect(ready.ok).toBe(true);
    const readyIds = ready.data?.map((b) => b.id);
    expect(readyIds).toContain("R1");
    expect(readyIds).not.toContain("R2");
  });
});

describe("KnotsBackend coverage: update with parent manipulation", () => {
  it("replaces existing parent with new parent", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "UP1", title: "Old Parent" });
    insertKnot({ id: "UP2", title: "New Parent" });
    insertKnot({ id: "UC1", title: "Child" });
    store.edges.push({
      src: "UP1", kind: "parent_of", dst: "UC1",
    });

    const result = await backend.update("UC1", { parent: "UP2" });
    expect(result.ok).toBe(true);

    expect(mockRemoveEdge).toHaveBeenCalledWith(
      "UP1", "parent_of", "UC1", "/repo",
    );
    expect(mockAddEdge).toHaveBeenCalledWith(
      "UP2", "parent_of", "UC1", "/repo",
    );
  });

  it("removes parent when parent is empty string", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "RP1", title: "Parent" });
    insertKnot({ id: "RC1", title: "Child" });
    store.edges.push({
      src: "RP1", kind: "parent_of", dst: "RC1",
    });

    const result = await backend.update("RC1", { parent: "" });
    expect(result.ok).toBe(true);
    expect(mockRemoveEdge).toHaveBeenCalledWith(
      "RP1", "parent_of", "RC1", "/repo",
    );
  });

  it("skips removing when new parent is same as existing", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SP1", title: "Same Parent" });
    insertKnot({ id: "SC1", title: "Child" });
    store.edges.push({
      src: "SP1", kind: "parent_of", dst: "SC1",
    });

    const result = await backend.update("SC1", { parent: "SP1" });
    expect(result.ok).toBe(true);
    expect(mockRemoveEdge).not.toHaveBeenCalled();
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  it("changes profileId via kno profile set", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PID1", title: "Test" });

    const result = await backend.update(
      "PID1", { profileId: "semiauto" },
    );
    expect(result.ok).toBe(true);
    expect(mockSetKnotProfile).toHaveBeenCalledWith(
      "PID1",
      "semiauto",
      "/repo",
      expect.objectContaining({ state: "ready_for_planning" }),
    );
    expect(
      store.knots.get("PID1")?.profile_id,
    ).toBe("semiauto");
  });

  it("passes profile etag as ifMatch when changing profile", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PID3",
      title: "Test etag",
      profile_etag: "profile-etag-123",
    });

    const result = await backend.update(
      "PID3", { profileId: "semiauto" },
    );
    expect(result.ok).toBe(true);
    expect(mockSetKnotProfile).toHaveBeenCalledWith(
      "PID3",
      "semiauto",
      "/repo",
      expect.objectContaining({ ifMatch: "profile-etag-123" }),
    );
  });

  it("returns INVALID_INPUT when profileId is unknown", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PID2", title: "Test" });

    const result = await backend.update(
      "PID2", { profileId: "new-profile" },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("Unknown profile");
  });

  it("passes acceptance criteria through the native acceptance field", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "AC1", title: "Accept test" });

    const result = await backend.update("AC1", {
      acceptance: "Must pass all tests",
    });
    expect(result.ok).toBe(true);
    expect(mockUpdateKnot).toHaveBeenCalledWith(
      "AC1",
      expect.objectContaining({ acceptance: "Must pass all tests" }),
      "/repo",
    );
  });
});

describe("KnotsBackend coverage: removeDependency", () => {
  it("removes a blocked_by edge", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "RD1", title: "Blocker" });
    insertKnot({ id: "RD2", title: "Blocked" });
    store.edges.push({
      src: "RD2", kind: "blocked_by", dst: "RD1",
    });

    const result = await backend.removeDependency("RD1", "RD2");
    expect(result.ok).toBe(true);
    expect(mockRemoveEdge).toHaveBeenCalledWith(
      "RD2", "blocked_by", "RD1", "/repo",
    );
  });

  it("returns error when edge does not exist", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.removeDependency("X1", "X2");
    expect(result.ok).toBe(false);
  });
});
