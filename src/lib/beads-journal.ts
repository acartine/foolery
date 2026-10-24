/** Deterministic journal mirror; process and clock access live at the runtime edge. */
import type { Beat } from "./types";

export interface BeadsJournalRecord {
  seq: number;
  op: string;
  issue_id: string;
  issue: Record<string, unknown> | null;
  dep?: { kind: string; target: string; metadata?: unknown };
}

export function parseJournalRecord(line: string): BeadsJournalRecord {
  const value = JSON.parse(line) as BeadsJournalRecord;
  if (!Number.isSafeInteger(value.seq) || value.seq <= 0
    || typeof value.issue_id !== "string"
    || !["create", "update", "close", "delete", "dep_add", "dep_remove", "comment"]
      .includes(value.op)
    || (value.issue === null && !["delete", "dep_add", "dep_remove"].includes(value.op))
    || (value.issue !== null && (!value.issue || value.issue.id !== value.issue_id))) {
    throw new Error("Invalid Beads events journal record");
  }
  return value;
}

export class BeadsJournalMirror {
  private beats = new Map<string, Beat>();
  sequence = 0;

  constructor(private readonly normalize: (raw: Record<string, unknown>) => Beat) {}

  baseline(beats: Beat[], sequence: number): void {
    this.beats = new Map(beats.map((beat) => [beat.id, beat]));
    this.sequence = sequence;
  }

  apply(record: BeadsJournalRecord): boolean {
    if (record.seq <= this.sequence) return false;
    if (record.op === "delete" || record.issue === null) {
      this.beats.delete(record.issue_id);
    } else {
      // The journal omits is_blocked when false. Replace the whole snapshot,
      // rather than merging it with the previous (possibly blocked) state.
      const previous = this.beats.get(record.issue_id);
      const beat = this.normalize({ ...record.issue,
        is_blocked: record.issue.is_blocked === true });
      // Journal snapshots contain scalar issue state and labels, not the
      // relationship hydration included in list/show. Preserve that separately.
      beat.parent = previous?.parent ?? beat.parent;
      const oldDeps = (previous as unknown as { dependencies?: Record<string, unknown>[] })
        ?.dependencies;
      let dependencies = oldDeps ? [...oldDeps] : undefined;
      if (record.dep) {
        dependencies = (dependencies ?? []).filter((dep) =>
          !(dep.type === record.dep!.kind && dep.depends_on_id === record.dep!.target));
        if (record.op === "dep_add") dependencies.push({ type: record.dep.kind,
          depends_on_id: record.dep.target });
        if (record.dep.kind === "parent-child") {
          if (record.op === "dep_add") beat.parent = record.dep.target;
          else if (beat.parent === record.dep.target) beat.parent = undefined;
        }
      }
      if (dependencies) Object.assign(beat, { dependencies });
      this.beats.set(record.issue_id, beat);
    }
    this.sequence = record.seq;
    return true;
  }

  snapshot(): Beat[] {
    return Array.from(this.beats.values());
  }
}
