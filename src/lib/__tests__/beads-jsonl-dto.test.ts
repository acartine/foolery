/**
 * Round-trip and field-mapping tests for the JSONL DTO translation layer.
 *
 * Validates that normalizeFromJsonl and denormalizeToJsonl correctly
 * translate between the on-disk RawBead format and the domain Bead type.
 */

import { describe, expect, it } from "vitest";

import type { Beat } from "@/lib/types";
import {
  normalizeFromJsonl,
  denormalizeToJsonl,
} from "@/lib/backends/beads-jsonl-dto";
import type { RawBead } from "@/lib/backends/beads-jsonl-dto";

// ── Fixtures ────────────────────────────────────────────────────

function fullRawBead(): RawBead {
  return {
    id: "proj.epic.1",
    title: "Implement widget",
    description: "Build the widget component",
    notes: "See design doc",
    acceptance_criteria: "Widget renders correctly",
    issue_type: "feature",
    status: "in_progress",
    priority: 3,
    labels: ["frontend", "v2"],
    assignee: "alice",
    owner: "bob",
    parent: "proj.epic",
    due: "2026-03-01",
    estimated_minutes: 120,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "system",
    updated_at: "2026-02-01T00:00:00Z",
    closed_at: "2026-02-15T00:00:00Z",
    close_reason: "completed",
    metadata: { source: "import" },
  };
}

function fullDomainBeat(): Beat {
  return {
    id: "proj.epic.1",
    title: "Implement widget",
    description: "Build the widget component",
    notes: "See design doc",
    acceptance: "Widget renders correctly",
    type: "feature",
    state: "planning",
    priority: 3,
    labels: ["frontend", "v2"],
    assignee: "alice",
    owner: "bob",
    parent: "proj.epic",
    due: "2026-03-01",
    estimate: 120,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-02-01T00:00:00Z",
    closed: "2026-02-15T00:00:00Z",
    metadata: { source: "import" },
  };
}

// ── normalizeFromJsonl ──────────────────────────────────────────

describe("normalizeFromJsonl", () => {
  it("maps all RawBead fields to domain Bead", () => {
    const raw = fullRawBead();
    const beat = normalizeFromJsonl(raw);

    expect(beat.id).toBe("proj.epic.1");
    expect(beat.title).toBe("Implement widget");
    expect(beat.description).toBe("Build the widget component");
    expect(beat.notes).toBe("See design doc");
    expect(beat.acceptance).toBe("Widget renders correctly");
    expect(beat.type).toBe("feature");
    expect(beat.state).toBe("planning");
    expect(beat.priority).toBe(3);
    expect(beat.labels).toEqual(["frontend", "v2"]);
    expect(beat.assignee).toBe("alice");
    expect(beat.owner).toBe("bob");
    expect(beat.parent).toBe("proj.epic");
    expect(beat.due).toBe("2026-03-01");
    expect(beat.estimate).toBe(120);
    expect(beat.created).toBe("2026-01-01T00:00:00Z");
    expect(beat.updated).toBe("2026-02-01T00:00:00Z");
    expect(beat.closed).toBe("2026-02-15T00:00:00Z");
    expect(beat.metadata).toEqual({ source: "import", close_reason: "completed" });
  });

  it("infers parent from dotted ID when no explicit parent", () => {
    const raw: RawBead = { id: "a.b.c", title: "Child" };
    const beat = normalizeFromJsonl(raw);
    expect(beat.parent).toBe("a.b");
  });

  it("explicit parent overrides inferred parent", () => {
    const raw: RawBead = { id: "a.b.c", title: "Child", parent: "x.y" };
    const beat = normalizeFromJsonl(raw);
    expect(beat.parent).toBe("x.y");
  });

  it("returns undefined parent for top-level ID without dots", () => {
    const raw: RawBead = { id: "toplevel", title: "Root" };
    const beat = normalizeFromJsonl(raw);
    expect(beat.parent).toBeUndefined();
  });

  it("defaults type to task for invalid issue_type", () => {
    const raw: RawBead = { id: "x", title: "T", issue_type: "banana" };
    const beat = normalizeFromJsonl(raw);
    expect(beat.type).toBe("task");
  });

  it("defaults state to workflow initial for invalid status", () => {
    const raw: RawBead = { id: "x", title: "T", status: "limbo" };
    const beat = normalizeFromJsonl(raw);
    expect(beat.state).toBe("ready_for_planning");
  });

  it("defaults priority to 2 for out-of-range values", () => {
    const raw: RawBead = { id: "x", title: "T", priority: 99 };
    const beat = normalizeFromJsonl(raw);
    expect(beat.priority).toBe(2);
  });

  it("defaults priority to 2 for non-number values", () => {
    const raw: RawBead = { id: "x", title: "T", priority: "high" as unknown as number };
    const beat = normalizeFromJsonl(raw);
    expect(beat.priority).toBe(2);
  });

  it("handles missing optional fields gracefully", () => {
    const raw: RawBead = { id: "minimal", title: "Bare minimum" };
    const beat = normalizeFromJsonl(raw);

    expect(beat.id).toBe("minimal");
    expect(beat.title).toBe("Bare minimum");
    expect(beat.description).toBeUndefined();
    expect(beat.notes).toBeUndefined();
    expect(beat.acceptance).toBeUndefined();
    expect(beat.type).toBe("task");
    expect(beat.state).toBe("ready_for_planning");
    expect(beat.priority).toBe(2);
    expect(beat.labels).toEqual([]);
    expect(beat.assignee).toBeUndefined();
    expect(beat.owner).toBeUndefined();
    expect(beat.due).toBeUndefined();
    expect(beat.estimate).toBeUndefined();
    expect(beat.closed).toBeUndefined();
    expect(beat.metadata).toBeUndefined();
  });

  it("filters empty-string labels", () => {
    const raw: RawBead = { id: "x", title: "T", labels: ["a", "", "  ", "b"] };
    const beat = normalizeFromJsonl(raw);
    expect(beat.labels).toEqual(["a", "b"]);
  });

  it("reads acceptance from acceptance field as fallback", () => {
    const raw: RawBead & { acceptance?: string } = {
      id: "x",
      title: "T",
      acceptance: "Fallback criteria",
    };
    const beat = normalizeFromJsonl(raw as RawBead);
    expect(beat.acceptance).toBe("Fallback criteria");
  });

  it("prefers acceptance_criteria over acceptance fallback", () => {
    const raw = {
      id: "x",
      title: "T",
      acceptance_criteria: "Primary",
      acceptance: "Fallback",
    } as RawBead;
    const beat = normalizeFromJsonl(raw);
    expect(beat.acceptance).toBe("Primary");
  });

  it("reads estimate from estimate field as fallback", () => {
    const raw = { id: "x", title: "T", estimate: 60 } as RawBead;
    const beat = normalizeFromJsonl(raw);
    expect(beat.estimate).toBe(60);
  });

  it("prefers estimated_minutes over estimate fallback", () => {
    const raw = {
      id: "x",
      title: "T",
      estimated_minutes: 90,
      estimate: 60,
    } as RawBead;
    const beat = normalizeFromJsonl(raw);
    expect(beat.estimate).toBe(90);
  });

  it("reads created/updated from domain-style fields as fallback", () => {
    const raw = {
      id: "x",
      title: "T",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-02-01T00:00:00Z",
    } as RawBead;
    const beat = normalizeFromJsonl(raw);
    expect(beat.created).toBe("2026-01-01T00:00:00Z");
    expect(beat.updated).toBe("2026-02-01T00:00:00Z");
  });
});

// ── denormalizeToJsonl ──────────────────────────────────────────

describe("denormalizeToJsonl", () => {
  it("maps all domain Bead fields to RawBead", () => {
    const beat = fullDomainBeat();
    const raw = denormalizeToJsonl(beat);

    expect(raw.id).toBe("proj.epic.1");
    expect(raw.title).toBe("Implement widget");
    expect(raw.description).toBe("Build the widget component");
    expect(raw.notes).toBe("See design doc");
    expect(raw.acceptance_criteria).toBe("Widget renders correctly");
    expect(raw.issue_type).toBe("feature");
    expect(raw.status).toBe("in_progress");
    expect(raw.priority).toBe(3);
    expect(raw.labels).toEqual([
      "frontend",
      "v2",
      "wf:state:planning",
      "wf:profile:autopilot",
    ]);
    expect(raw.assignee).toBe("alice");
    expect(raw.owner).toBe("bob");
    expect(raw.parent).toBe("proj.epic");
    expect(raw.due).toBe("2026-03-01");
    expect(raw.estimated_minutes).toBe(120);
    expect(raw.created_at).toBe("2026-01-01T00:00:00Z");
    expect(raw.updated_at).toBe("2026-02-01T00:00:00Z");
    expect(raw.closed_at).toBe("2026-02-15T00:00:00Z");
    expect(raw.metadata).toEqual({ source: "import" });
  });

  it("serializes parent field", () => {
    const beat: Beat = {
      id: "a.b.c",
      title: "Child",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      parent: "a.b",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
    };
    const raw = denormalizeToJsonl(beat);
    expect(raw.parent).toBe("a.b");
  });

  it("omits optional fields when undefined", () => {
    const beat: Beat = {
      id: "minimal",
      title: "Bare",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
    };
    const raw = denormalizeToJsonl(beat);

    expect(raw.description).toBeUndefined();
    expect(raw.notes).toBeUndefined();
    expect(raw.acceptance_criteria).toBeUndefined();
    expect(raw.assignee).toBeUndefined();
    expect(raw.owner).toBeUndefined();
    expect(raw.parent).toBeUndefined();
    expect(raw.due).toBeUndefined();
    expect(raw.estimated_minutes).toBeUndefined();
    expect(raw.closed_at).toBeUndefined();
    expect(raw.metadata).toBeUndefined();
  });
});

// ── Round-trip fidelity ─────────────────────────────────────────

describe("round-trip: normalize -> denormalize -> normalize", () => {
  it("preserves all fields through full round-trip", () => {
    const original = fullRawBead();
    const domain = normalizeFromJsonl(original);
    const serialized = denormalizeToJsonl(domain);
    const restored = normalizeFromJsonl(serialized);

    expect(restored.id).toBe(domain.id);
    expect(restored.title).toBe(domain.title);
    expect(restored.description).toBe(domain.description);
    expect(restored.notes).toBe(domain.notes);
    expect(restored.acceptance).toBe(domain.acceptance);
    expect(restored.type).toBe(domain.type);
    expect(restored.state).toBe(domain.state);
    expect(restored.priority).toBe(domain.priority);
    expect(restored.labels).toEqual([
      ...domain.labels,
      "wf:state:planning",
      "wf:profile:autopilot",
    ]);
    expect(restored.assignee).toBe(domain.assignee);
    expect(restored.owner).toBe(domain.owner);
    expect(restored.parent).toBe(domain.parent);
    expect(restored.due).toBe(domain.due);
    expect(restored.estimate).toBe(domain.estimate);
    expect(restored.created).toBe(domain.created);
    expect(restored.updated).toBe(domain.updated);
    expect(restored.closed).toBe(domain.closed);
    expect(restored.metadata).toEqual(domain.metadata);
  });

  it("preserves minimal bead through round-trip", () => {
    const minimal: RawBead = { id: "solo", title: "Lone bead" };
    const domain = normalizeFromJsonl(minimal);
    const serialized = denormalizeToJsonl(domain);
    const restored = normalizeFromJsonl(serialized);

    expect(restored.id).toBe(domain.id);
    expect(restored.title).toBe(domain.title);
    expect(restored.type).toBe(domain.type);
    expect(restored.state).toBe(domain.state);
    expect(restored.priority).toBe(domain.priority);
    expect(restored.labels).toEqual([
      "wf:state:ready_for_planning",
      "wf:profile:autopilot",
    ]);
    expect(restored.parent).toBe(domain.parent);
  });

  it("preserves explicit parent that differs from inferred", () => {
    const raw: RawBead = {
      id: "a.b.c",
      title: "Reparented",
      parent: "x.y",
    };
    const domain = normalizeFromJsonl(raw);
    expect(domain.parent).toBe("x.y");

    const serialized = denormalizeToJsonl(domain);
    expect(serialized.parent).toBe("x.y");

    const restored = normalizeFromJsonl(serialized);
    expect(restored.parent).toBe("x.y");
  });

  it("round-trips acceptance_criteria mapping", () => {
    const raw: RawBead = {
      id: "x",
      title: "T",
      acceptance_criteria: "Must pass all tests",
    };
    const domain = normalizeFromJsonl(raw);
    expect(domain.acceptance).toBe("Must pass all tests");

    const serialized = denormalizeToJsonl(domain);
    expect(serialized.acceptance_criteria).toBe("Must pass all tests");

    const restored = normalizeFromJsonl(serialized);
    expect(restored.acceptance).toBe("Must pass all tests");
  });

  it("round-trips estimated_minutes mapping", () => {
    const raw: RawBead = { id: "x", title: "T", estimated_minutes: 45 };
    const domain = normalizeFromJsonl(raw);
    expect(domain.estimate).toBe(45);

    const serialized = denormalizeToJsonl(domain);
    expect(serialized.estimated_minutes).toBe(45);

    const restored = normalizeFromJsonl(serialized);
    expect(restored.estimate).toBe(45);
  });

  it("round-trips timestamp field mappings", () => {
    const raw: RawBead = {
      id: "x",
      title: "T",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
      closed_at: "2026-03-01T00:00:00Z",
    };
    const domain = normalizeFromJsonl(raw);
    expect(domain.created).toBe("2026-01-01T00:00:00Z");
    expect(domain.updated).toBe("2026-02-01T00:00:00Z");
    expect(domain.closed).toBe("2026-03-01T00:00:00Z");

    const serialized = denormalizeToJsonl(domain);
    expect(serialized.created_at).toBe("2026-01-01T00:00:00Z");
    expect(serialized.updated_at).toBe("2026-02-01T00:00:00Z");
    expect(serialized.closed_at).toBe("2026-03-01T00:00:00Z");

    const restored = normalizeFromJsonl(serialized);
    expect(restored.created).toBe("2026-01-01T00:00:00Z");
    expect(restored.updated).toBe("2026-02-01T00:00:00Z");
    expect(restored.closed).toBe("2026-03-01T00:00:00Z");
  });
});
