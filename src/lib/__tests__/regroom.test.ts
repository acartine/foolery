import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/types";

const mockList = vi.fn();
const mockClose = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    list: (...args: unknown[]) => mockList(...args),
    close: (...args: unknown[]) => mockClose(...args),
  }),
}));

import { regroomAncestors } from "@/lib/regroom";

function makeBeat(overrides: Partial<Beat> & { id: string; state: string }): Beat {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    type: overrides.type ?? "work",
    state: overrides.state,
    priority: overrides.priority ?? 2,
    labels: overrides.labels ?? [],
    created: overrides.created ?? "2026-01-01T00:00:00.000Z",
    updated: overrides.updated ?? "2026-01-01T00:00:00.000Z",
    description: overrides.description,
    notes: overrides.notes,
    acceptance: overrides.acceptance,
    workflowId: overrides.workflowId,
    workflowMode: overrides.workflowMode,
    profileId: overrides.profileId,
    nextActionState: overrides.nextActionState,
    nextActionOwnerKind: overrides.nextActionOwnerKind,
    requiresHumanAction: overrides.requiresHumanAction,
    isAgentClaimable: overrides.isAgentClaimable,
    assignee: overrides.assignee,
    owner: overrides.owner,
    parent: overrides.parent,
    due: overrides.due,
    estimate: overrides.estimate,
    closed: overrides.closed,
    metadata: overrides.metadata,
  };
}

describe("regroomAncestors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClose.mockResolvedValue({ ok: true });
  });

  it("auto-closes a parent when all children are terminal in knots states", async () => {
    const beats: Beat[] = [
      makeBeat({ id: "P", state: "ready_for_planning" }),
      makeBeat({ id: "C1", parent: "P", state: "shipped" }),
      makeBeat({ id: "C2", parent: "P", state: "abandoned" }),
    ];
    mockList.mockResolvedValue({ ok: true, data: beats });

    await regroomAncestors("C1", "/repo");

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledWith("P", undefined, "/repo");
  });

  it("does not auto-close when at least one child is non-terminal", async () => {
    const beats: Beat[] = [
      makeBeat({ id: "P", state: "ready_for_planning" }),
      makeBeat({ id: "C1", parent: "P", state: "shipped" }),
      makeBeat({ id: "C2", parent: "P", state: "implementation_review" }),
    ];
    mockList.mockResolvedValue({ ok: true, data: beats });

    await regroomAncestors("C1", "/repo");

    expect(mockClose).not.toHaveBeenCalled();
  });

  it("cascades upward after closing an ancestor", async () => {
    const beats: Beat[] = [
      makeBeat({ id: "G", state: "ready_for_planning" }),
      makeBeat({ id: "P", parent: "G", state: "ready_for_planning" }),
      makeBeat({ id: "C1", parent: "P", state: "shipped" }),
      makeBeat({ id: "C2", parent: "P", state: "shipped" }),
    ];
    mockList.mockResolvedValue({ ok: true, data: beats });

    await regroomAncestors("C1", "/repo");

    expect(mockClose).toHaveBeenNthCalledWith(1, "P", undefined, "/repo");
    expect(mockClose).toHaveBeenNthCalledWith(2, "G", undefined, "/repo");
  });
});
