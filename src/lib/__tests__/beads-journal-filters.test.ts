import { describe, expect, it } from "vitest";
import { filterJournalBeats } from "../beads-journal-filters";
import { normalizeBeat, applyWorkflowFilters } from "../bd-queries";
import type { BeatListFilters } from "../backend-port";
const beats = [
  normalizeBeat({ id: "a", title: "Task", status: "open", issue_type: "task", priority: 1 }),
  normalizeBeat({ id: "b", title: "Bug", status: "closed", issue_type: "bug", priority: 2 }),
];

describe("journal mirror filters match CLI list behavior", () => {
  it("accepts API string and typed priority/human flags with identical results", () => {
    expect(filterJournalBeats(beats, { priority: "1" } as unknown as BeatListFilters))
      .toEqual(filterJournalBeats(beats, { priority: 1 }));
    expect(filterJournalBeats(beats, { requiresHumanAction: "true" } as unknown as BeatListFilters))
      .toEqual(applyWorkflowFilters(beats, { requiresHumanAction: "true" }));
    expect(filterJournalBeats(beats, { requiresHumanAction: false }))
      .toEqual(applyWorkflowFilters(beats, { requiresHumanAction: "false" }));
  });

  it("keeps replayed default-hidden issues out of ordinary --all results", () => {
    const hidden = [
      ...["gate", "agent", "role", "message"].map((issue_type) => normalizeBeat({
        id: issue_type, title: issue_type, issue_type, status: "open" })),
      ...[{ is_template: true }].map((flags) =>
        normalizeBeat({ id: "hidden-task", issue_type: "task", status: "open", ...flags })),
    ];
    expect(filterJournalBeats([...beats, ...hidden])).toEqual(beats);
    expect(filterJournalBeats([...beats, ...hidden], { type: "task" })).toEqual([beats[0]]);
  });

  it("delegates ambiguous ephemeral plane membership to the native CLI", () => {
    for (const flags of [{ ephemeral: true }, { no_history: true }]) {
      const ambiguous = normalizeBeat({ id: "promoted", issue_type: "task", ...flags });
      expect(filterJournalBeats([...beats, ambiguous])).toBeUndefined();
    }
  });

  it("keeps closed issues in the unfiltered --all snapshot", () => {
    expect(filterJournalBeats(beats)).toEqual(beats);
    expect(filterJournalBeats(beats, { type: "bug" })).toEqual([beats[1]]);
  });

  it("delegates state/complex native filters instead of changing their membership", () => {
    for (const filters of [{ state: "queued" }, { state: "in_action" }, { state: "closed" },
      { parent: "a" }, { label: "one,two" }, { type: "gate" }, { priority: "invalid" }]) {
      expect(filterJournalBeats(beats, filters as BeatListFilters)).toBeUndefined();
    }
  });
});
