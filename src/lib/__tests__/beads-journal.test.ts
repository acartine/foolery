import { describe, expect, it } from "vitest";
import { BeadsJournalMirror, parseJournalRecord } from "../beads-journal";
import { normalizeBeat } from "../bd-queries";

const issue = { id: "demo-1", title: "Initial", status: "open", labels: [], priority: 2,
  created_at: "2026-01-01", updated_at: "2026-01-01" };
function record(seq: number, op = "update", fields = {}) {
  return parseJournalRecord(JSON.stringify({ seq, op, issue_id: "demo-1",
    issue: op === "delete" ? null : { ...issue, ...fields } }));
}

describe("Beads journal replay", () => {
  it("replaces full snapshots, including an omitted false blocked flag", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    mirror.baseline([normalizeBeat({ ...issue, is_blocked: true })], 1);
    mirror.apply(record(2, "update", { title: "Updated" }));
    expect(mirror.snapshot()).toMatchObject([{ id: "demo-1", title: "Updated", is_blocked: false }]);
  });

  it("applies all seven mutation types, and removes deletes", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    for (const [index, op] of ["create", "update", "close", "dep_add", "dep_remove", "comment"]
      .entries()) {
      expect(mirror.apply(record(index + 1, op, { title: op }))).toBe(true);
      expect(mirror.snapshot()[0].title).toBe(op);
    }
    mirror.apply(record(7, "delete"));
    expect(mirror.snapshot()).toEqual([]);
  });

  it("ignores duplicate/older delivery and accepts gaps in sequence values", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    mirror.apply(record(11, "update", { title: "Newest" }));
    expect(mirror.apply(record(11))).toBe(false);
    expect(mirror.apply(record(3))).toBe(false);
    expect(mirror.sequence).toBe(11);
    expect(mirror.snapshot()[0].title).toBe("Newest");
  });

  it("replaces clone-local state and checkpoint on a new baseline", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    mirror.apply(record(11));
    mirror.baseline([], 0);
    expect(mirror.snapshot()).toEqual([]);
    expect(mirror.apply(record(1))).toBe(true);
  });

  it("rejects malformed, unknown and mismatched records before advancing", () => {
    for (const fields of [{ seq: -1 }, { seq: 1.5 }, { op: "unknown" },
      { issue: null }, { issue: { id: "other" } }]) {
      const raw = { seq: 1, op: "update", issue_id: "demo-1", issue, ...fields };
      expect(() => parseJournalRecord(JSON.stringify(raw))).toThrow();
    }
  });
});

describe("Beads journal relationship state", () => {
  it("preserves a non-dot parent across scalar updates and applies parent edges", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    mirror.baseline([normalizeBeat({ ...issue, parent: "parent-1", dependencies: [
      { type: "parent-child", depends_on_id: "parent-1" },
    ] })], 1);
    mirror.apply(record(2));
    expect(mirror.snapshot()[0].parent).toBe("parent-1");
    mirror.apply({ ...record(3, "dep_remove"), dep: { kind: "parent-child", target: "parent-1" } });
    expect(mirror.snapshot()[0].parent).toBeUndefined();
    mirror.apply({ ...record(4, "dep_add"), dep: { kind: "parent-child", target: "parent-2" } });
    expect(mirror.snapshot()[0].parent).toBe("parent-2");
  });

  it("accepts null dependency snapshots from cascading deletion without resurrection", () => {
    const mirror = new BeadsJournalMirror(normalizeBeat);
    mirror.apply(record(1));
    const removed = parseJournalRecord(JSON.stringify({ seq: 2, op: "dep_remove",
      issue_id: "demo-1", issue: null, dep: { kind: "blocks", target: "other" } }));
    mirror.apply(removed);
    expect(mirror.sequence).toBe(2);
    expect(mirror.snapshot()).toEqual([]);
  });
});
