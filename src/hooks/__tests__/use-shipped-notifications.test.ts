import { describe, it, expect } from "vitest";
import type { Beat } from "@/lib/types";
import {
  diffNewlyShippedBeats,
  selectTerminalShippedBeats,
} from "@/hooks/use-shipped-notifications";

function makeBeat(overrides: Partial<Beat>): Beat {
  return {
    id: "foolery-1",
    title: "Test beat",
    type: "work",
    state: "open",
    priority: 2,
    labels: [],
    created: "2026-03-03T00:00:00.000Z",
    updated: "2026-03-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("useShippedNotifications helpers", () => {
  it("selects only shipped and closed beats", () => {
    const beats: Beat[] = [
      makeBeat({ id: "foolery-1", state: "open" }),
      makeBeat({ id: "foolery-2", state: "ready_for_shipment" }),
      makeBeat({ id: "foolery-3", state: "shipped" }),
      makeBeat({ id: "foolery-4", state: "closed" }),
    ];

    const terminal = selectTerminalShippedBeats(beats);
    expect(terminal.map((b) => b.id)).toEqual(["foolery-3", "foolery-4"]);
  });

  it("returns only beats newly entering shipped/closed states", () => {
    const beats: Beat[] = [
      makeBeat({ id: "foolery-2", title: "Already shipped", state: "shipped" }),
      makeBeat({ id: "foolery-3", title: "Freshly shipped", state: "shipped" }),
      makeBeat({ id: "foolery-4", title: "Freshly closed", state: "closed" }),
      makeBeat({ id: "foolery-5", title: "Still open", state: "open" }),
    ];
    const previous = new Set(["foolery-2"]);

    const result = diffNewlyShippedBeats(beats, previous);

    expect(result.newlyShipped.map((b) => b.id)).toEqual([
      "foolery-3",
      "foolery-4",
    ]);
    expect(result.newlyShipped.map((b) => b.title)).toEqual([
      "Freshly shipped",
      "Freshly closed",
    ]);
    expect(Array.from(result.terminalIds).sort()).toEqual([
      "foolery-2",
      "foolery-3",
      "foolery-4",
    ]);
  });

  it("returns no new beats when terminal ids are unchanged", () => {
    const beats: Beat[] = [
      makeBeat({ id: "foolery-10", state: "shipped" }),
      makeBeat({ id: "foolery-11", state: "closed" }),
    ];
    const previous = new Set(["foolery-10", "foolery-11"]);

    const result = diffNewlyShippedBeats(beats, previous);

    expect(result.newlyShipped).toHaveLength(0);
    expect(Array.from(result.terminalIds).sort()).toEqual([
      "foolery-10",
      "foolery-11",
    ]);
  });
});
