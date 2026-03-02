import { beforeEach, describe, expect, it } from "vitest";
import {
  recordCompatStatusSerialized,
  recordCompatStatusConsumed,
  getCompatStatusUsageSnapshot,
  resetCompatStatusUsageForTests,
} from "@/lib/compat-status-usage";

describe("compat-status-usage coverage", () => {
  beforeEach(() => {
    resetCompatStatusUsageForTests();
  });

  it("getCompatStatusUsageSnapshot returns zeroed snapshot after reset", () => {
    const snapshot = getCompatStatusUsageSnapshot();
    expect(snapshot.serialized).toBe(0);
    expect(snapshot.consumed).toBe(0);
    expect(snapshot.serializedByContext).toEqual({});
    expect(snapshot.consumedByContext).toEqual({});
  });

  it("tracks serialized calls by context", () => {
    recordCompatStatusSerialized("test-a");
    recordCompatStatusSerialized("test-a");
    recordCompatStatusSerialized("test-b");

    const snapshot = getCompatStatusUsageSnapshot();
    expect(snapshot.serialized).toBe(3);
    expect(snapshot.serializedByContext).toEqual({ "test-a": 2, "test-b": 1 });
  });

  it("tracks consumed calls by context", () => {
    recordCompatStatusConsumed("ctx-x");
    recordCompatStatusConsumed("ctx-y");

    const snapshot = getCompatStatusUsageSnapshot();
    expect(snapshot.consumed).toBe(2);
    expect(snapshot.consumedByContext).toEqual({ "ctx-x": 1, "ctx-y": 1 });
  });

  it("uses 'unknown' for blank context strings", () => {
    recordCompatStatusSerialized("  ");
    recordCompatStatusConsumed("");

    const snapshot = getCompatStatusUsageSnapshot();
    expect(snapshot.serializedByContext).toEqual({ unknown: 1 });
    expect(snapshot.consumedByContext).toEqual({ unknown: 1 });
  });

  it("snapshot is a copy that does not mutate internal state", () => {
    recordCompatStatusSerialized("a");
    const snapshot = getCompatStatusUsageSnapshot();
    snapshot.serializedByContext["a"] = 999;

    const fresh = getCompatStatusUsageSnapshot();
    expect(fresh.serializedByContext["a"]).toBe(1);
  });

  it("resetCompatStatusUsageForTests clears all counters", () => {
    recordCompatStatusSerialized("a");
    recordCompatStatusConsumed("b");
    resetCompatStatusUsageForTests();

    const snapshot = getCompatStatusUsageSnapshot();
    expect(snapshot.serialized).toBe(0);
    expect(snapshot.consumed).toBe(0);
    expect(snapshot.serializedByContext).toEqual({});
    expect(snapshot.consumedByContext).toEqual({});
  });
});
