import { describe, expect, it } from "vitest";
import {
  KNOTS_BLOCKED_BY_EDGE_KIND,
  KNOTS_CLOSE_TARGET_STATE,
  KNOTS_METADATA_KEYS,
  KNOTS_PARENT_OF_EDGE_KIND,
  KNOTS_SUPPORTS_DELETE,
  KNOTS_SUPPORTS_SYNC,
} from "@/lib/knots-constants";

describe("edge kind constants", () => {
  it("KNOTS_BLOCKED_BY_EDGE_KIND is 'blocked_by'", () => {
    expect(KNOTS_BLOCKED_BY_EDGE_KIND).toBe("blocked_by");
  });

  it("KNOTS_PARENT_OF_EDGE_KIND is 'parent_of'", () => {
    expect(KNOTS_PARENT_OF_EDGE_KIND).toBe("parent_of");
  });
});

describe("close behavior", () => {
  it("KNOTS_CLOSE_TARGET_STATE is 'shipped'", () => {
    expect(KNOTS_CLOSE_TARGET_STATE).toBe("shipped");
  });
});

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

describe("capability flags", () => {
  it("KNOTS_SUPPORTS_DELETE is false", () => {
    expect(KNOTS_SUPPORTS_DELETE).toBe(false);
  });

  it("KNOTS_SUPPORTS_SYNC is true", () => {
    expect(KNOTS_SUPPORTS_SYNC).toBe(true);
  });
});
