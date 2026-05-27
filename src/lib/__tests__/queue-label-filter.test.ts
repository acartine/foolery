import { describe, expect, it } from "vitest";
import {
  buildQueueLabelFilterOptions,
  filterBeatsByQueueLabel,
} from "@/lib/queue-label-filter";
import type { Beat } from "@/lib/types";

function makeBeat(id: string, labels: string[]): Beat {
  return {
    id,
    title: id,
    type: "work",
    state: "queued",
    priority: 2,
    labels,
    created: "2026-05-01T00:00:00.000Z",
    updated: "2026-05-01T00:00:00.000Z",
  } as Beat;
}

describe("queue label filter", () => {
  it("builds sorted distinct labels from backend-returned beats", () => {
    const options = buildQueueLabelFilterOptions([
      makeBeat("a", ["frontend", "stage:implementation"]),
      makeBeat("b", ["backend", "frontend", "  UX  "]),
      makeBeat("c", ["", "  "]),
    ]);

    expect(options).toEqual([
      "backend",
      "frontend",
      "stage:implementation",
      "UX",
    ]);
  });

  it("filters beats by selected label and clears to the full list", () => {
    const beats = [
      makeBeat("a", ["frontend"]),
      makeBeat("b", ["backend", "  frontend  "]),
      makeBeat("c", ["backend"]),
    ];

    expect(
      filterBeatsByQueueLabel(beats, "frontend").map((beat) => beat.id),
    ).toEqual(["a", "b"]);
    expect(
      filterBeatsByQueueLabel(beats, null).map((beat) => beat.id),
    ).toEqual(["a", "b", "c"]);
  });
});
