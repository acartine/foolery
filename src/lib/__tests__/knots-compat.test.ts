import { describe, expect, it } from "vitest";
import {
  FOOLERY_TO_KNOTS_STATUS,
  KNOTS_BLOCKED_BY_EDGE_KIND,
  KNOTS_CLOSE_TARGET_STATE,
  KNOTS_METADATA_KEYS,
  KNOTS_PARENT_OF_EDGE_KIND,
  KNOTS_SUPPORTS_DELETE,
  KNOTS_SUPPORTS_SYNC,
  KNOTS_TO_FOOLERY_STATUS,
  mapFooleryStatusToKnotsState,
  mapKnotsStateToFooleryStatus,
} from "@/lib/knots-compat";

// ── ADR-locked mapping tables (source of truth for assertions) ─────────────

const ADR_KNOTS_TO_FOOLERY: Array<[string, string]> = [
  ["idea", "open"],
  ["work_item", "open"],
  ["implementing", "in_progress"],
  ["implemented", "in_progress"],
  ["reviewing", "in_progress"],
  ["refining", "in_progress"],
  ["approved", "in_progress"],
  ["rejected", "blocked"],
  ["deferred", "deferred"],
  ["shipped", "closed"],
  ["abandoned", "closed"],
];

const ADR_FOOLERY_TO_KNOTS: Array<[string, string]> = [
  ["open", "work_item"],
  ["in_progress", "implementing"],
  ["blocked", "rejected"],
  ["deferred", "deferred"],
  ["closed", "shipped"],
];

// ── Knots → Foolery status map ─────────────────────────────────────────────

describe("KNOTS_TO_FOOLERY_STATUS map", () => {
  it("contains exactly the ADR-locked entries", () => {
    expect(KNOTS_TO_FOOLERY_STATUS.size).toBe(ADR_KNOTS_TO_FOOLERY.length);
    for (const [knotsState, expected] of ADR_KNOTS_TO_FOOLERY) {
      expect(KNOTS_TO_FOOLERY_STATUS.get(knotsState)).toBe(expected);
    }
  });

  it.each(ADR_KNOTS_TO_FOOLERY)("%s → %s", (knotsState, expected) => {
    expect(KNOTS_TO_FOOLERY_STATUS.get(knotsState)).toBe(expected);
  });
});

// ── Foolery → Knots status map ─────────────────────────────────────────────

describe("FOOLERY_TO_KNOTS_STATUS map", () => {
  it("contains exactly the ADR-locked entries", () => {
    expect(FOOLERY_TO_KNOTS_STATUS.size).toBe(ADR_FOOLERY_TO_KNOTS.length);
    for (const [fooleryStatus, expected] of ADR_FOOLERY_TO_KNOTS) {
      expect(FOOLERY_TO_KNOTS_STATUS.get(fooleryStatus)).toBe(expected);
    }
  });

  it.each(ADR_FOOLERY_TO_KNOTS)("%s → %s", (fooleryStatus, expected) => {
    expect(FOOLERY_TO_KNOTS_STATUS.get(fooleryStatus)).toBe(expected);
  });
});

// ── mapKnotsStateToFooleryStatus ───────────────────────────────────────────

describe("mapKnotsStateToFooleryStatus", () => {
  it.each(ADR_KNOTS_TO_FOOLERY)("maps %s → %s", (knotsState, expected) => {
    expect(mapKnotsStateToFooleryStatus(knotsState)).toBe(expected);
  });

  it("handles mixed case", () => {
    expect(mapKnotsStateToFooleryStatus("SHIPPED")).toBe("closed");
    expect(mapKnotsStateToFooleryStatus("Implementing")).toBe("in_progress");
    expect(mapKnotsStateToFooleryStatus("Work_Item")).toBe("open");
  });

  it("trims whitespace", () => {
    expect(mapKnotsStateToFooleryStatus("  shipped  ")).toBe("closed");
    expect(mapKnotsStateToFooleryStatus("\tdeferred\n")).toBe("deferred");
  });

  it("returns 'open' for unknown states", () => {
    expect(mapKnotsStateToFooleryStatus("unknown_state")).toBe("open");
    expect(mapKnotsStateToFooleryStatus("foobar")).toBe("open");
  });

  it("returns 'open' for empty string", () => {
    expect(mapKnotsStateToFooleryStatus("")).toBe("open");
    expect(mapKnotsStateToFooleryStatus("   ")).toBe("open");
  });
});

// ── mapFooleryStatusToKnotsState ───────────────────────────────────────────

describe("mapFooleryStatusToKnotsState", () => {
  it.each(ADR_FOOLERY_TO_KNOTS)("maps %s → %s", (fooleryStatus, expected) => {
    expect(mapFooleryStatusToKnotsState(fooleryStatus)).toBe(expected);
  });

  it("handles mixed case", () => {
    expect(mapFooleryStatusToKnotsState("CLOSED")).toBe("shipped");
    expect(mapFooleryStatusToKnotsState("In_Progress")).toBe("implementing");
    expect(mapFooleryStatusToKnotsState("BLOCKED")).toBe("rejected");
  });

  it("trims whitespace", () => {
    expect(mapFooleryStatusToKnotsState("  closed  ")).toBe("shipped");
    expect(mapFooleryStatusToKnotsState("\topen\n")).toBe("work_item");
  });

  it("returns 'work_item' for unknown statuses", () => {
    expect(mapFooleryStatusToKnotsState("unknown")).toBe("work_item");
    expect(mapFooleryStatusToKnotsState("foobar")).toBe("work_item");
  });

  it("returns 'work_item' for empty string", () => {
    expect(mapFooleryStatusToKnotsState("")).toBe("work_item");
    expect(mapFooleryStatusToKnotsState("   ")).toBe("work_item");
  });
});

// ── Round-trip stability ───────────────────────────────────────────────────

describe("round-trip: Foolery → Knots → Foolery preserves status", () => {
  it.each(ADR_FOOLERY_TO_KNOTS)("%s round-trips correctly", (fooleryStatus) => {
    const knotsState = mapFooleryStatusToKnotsState(fooleryStatus);
    const backToFoolery = mapKnotsStateToFooleryStatus(knotsState);
    expect(backToFoolery).toBe(fooleryStatus);
  });
});

// ── Edge / Dependency constants ────────────────────────────────────────────

describe("edge kind constants", () => {
  it("KNOTS_BLOCKED_BY_EDGE_KIND is 'blocked_by'", () => {
    expect(KNOTS_BLOCKED_BY_EDGE_KIND).toBe("blocked_by");
  });

  it("KNOTS_PARENT_OF_EDGE_KIND is 'parent_of'", () => {
    expect(KNOTS_PARENT_OF_EDGE_KIND).toBe("parent_of");
  });
});

// ── Close behavior ─────────────────────────────────────────────────────────

describe("close behavior", () => {
  it("KNOTS_CLOSE_TARGET_STATE is 'shipped'", () => {
    expect(KNOTS_CLOSE_TARGET_STATE).toBe("shipped");
  });

  it("close target maps back to 'closed' in Foolery", () => {
    expect(mapKnotsStateToFooleryStatus(KNOTS_CLOSE_TARGET_STATE)).toBe("closed");
  });
});

// ── Metadata keys ──────────────────────────────────────────────────────────

describe("metadata keys", () => {
  it("KNOTS_METADATA_KEYS has all expected keys", () => {
    expect(KNOTS_METADATA_KEYS.profileId).toBe("knotsProfileId");
    expect(KNOTS_METADATA_KEYS.state).toBe("knotsState");
    expect(KNOTS_METADATA_KEYS.profileEtag).toBe("knotsProfileEtag");
    expect(KNOTS_METADATA_KEYS.workflowEtag).toBe("knotsWorkflowEtag");
    expect(KNOTS_METADATA_KEYS.handoffCapsules).toBe("knotsHandoffCapsules");
    expect(KNOTS_METADATA_KEYS.notes).toBe("knotsNotes");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(KNOTS_METADATA_KEYS)).toBe(true);
  });
});

// ── Capability flags ───────────────────────────────────────────────────────

describe("capability flags", () => {
  it("KNOTS_SUPPORTS_DELETE is false", () => {
    expect(KNOTS_SUPPORTS_DELETE).toBe(false);
  });

  it("KNOTS_SUPPORTS_SYNC is true", () => {
    expect(KNOTS_SUPPORTS_SYNC).toBe(true);
  });
});
