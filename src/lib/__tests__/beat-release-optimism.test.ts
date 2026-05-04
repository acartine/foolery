import { describe, expect, it } from "vitest";
import type { Beat } from "@/lib/types";
import {
  applyPendingBeatReleases,
  createPendingBeatRelease,
  settledPendingBeatReleaseKeys,
} from "@/lib/beat-release-optimism";

function makeBeat(
  overrides: Partial<Beat> & { id?: string; state?: string } = {},
): Beat {
  return {
    id: overrides.id ?? "beat-1",
    title: "Test beat",
    type: "work",
    state: overrides.state ?? "implementation",
    priority: 2,
    labels: [],
    created: "2026-05-04T07:00:00.000Z",
    updated: "2026-05-04T08:00:00.000Z",
    ...overrides,
  };
}

describe("beat release optimism", () => {
  it("maps active states back to their ready state immediately", () => {
    const beat = makeBeat();
    const pending = createPendingBeatRelease(
      beat,
      "/repo",
      "2026-05-04T09:00:00.000Z",
    );

    expect(pending).toMatchObject({
      key: "/repo:beat-1",
      originalState: "implementation",
      targetState: "ready_for_implementation",
    });
    if (!pending) throw new Error("expected pending release");
    expect(
      applyPendingBeatReleases([beat], new Map([[pending.key, pending]])),
    ).toMatchObject([{
      state: "ready_for_implementation",
      updated: "2026-05-04T09:00:00.000Z",
    }]);
  });

  it("keeps stale active refetches pending until server state changes", () => {
    const beat = makeBeat();
    const pending = createPendingBeatRelease(beat, undefined);
    if (!pending) throw new Error("expected pending release");
    const pendingMap = new Map([[pending.key, pending]]);

    expect(
      settledPendingBeatReleaseKeys([beat], pendingMap),
    ).toEqual([]);
    expect(
      settledPendingBeatReleaseKeys(
        [makeBeat({ state: "ready_for_implementation" })],
        pendingMap,
      ),
    ).toEqual([pending.key]);
  });

  it("ignores non-release states", () => {
    expect(
      createPendingBeatRelease(
        makeBeat({ state: "ready_for_implementation" }),
      ),
    ).toBeNull();
  });
});
