import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalEscalation } from "@/lib/approval-escalations";
import {
  selectPendingApprovalCount,
  selectPendingApprovals,
  useApprovalEscalationStore,
} from "@/stores/approval-escalation-store";

function makeApproval(
  id: string,
  notificationKey = id,
): ApprovalEscalation {
  return {
    id,
    notificationKey,
    status: "pending",
    sessionId: "sess-1",
    beatId: "beat-1",
    adapter: "codex",
    source: "mcpServer/elicitation/request",
    options: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("approval escalation store", () => {
  beforeEach(() => {
    useApprovalEscalationStore.setState({ approvals: [] });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores pending approvals and exposes pending counts", () => {
    const created = useApprovalEscalationStore
      .getState()
      .upsertPendingApproval(makeApproval("approval-1"));

    expect(created).toBe(true);
    expect(selectPendingApprovalCount(
      useApprovalEscalationStore.getState(),
    )).toBe(1);
    expect(selectPendingApprovals(
      useApprovalEscalationStore.getState(),
    )[0]?.id).toBe("approval-1");
  });

  it("suppresses duplicate approval identities", () => {
    const store = useApprovalEscalationStore.getState();

    expect(store.upsertPendingApproval(
      makeApproval("approval-1", "same"),
    )).toBe(true);
    expect(store.upsertPendingApproval(
      makeApproval("approval-2", "same"),
    )).toBe(false);
    expect(useApprovalEscalationStore.getState().approvals)
      .toHaveLength(1);
  });

  it("marks approvals manual and dismissed with pending selector changes", () => {
    const store = useApprovalEscalationStore.getState();
    store.upsertPendingApproval(makeApproval("approval-1"));

    store.markManualAction("approval-1");
    expect(selectPendingApprovals(
      useApprovalEscalationStore.getState(),
    )[0]?.status).toBe("manual_required");

    store.dismissApproval("approval-1");
    expect(selectPendingApprovalCount(
      useApprovalEscalationStore.getState(),
    )).toBe(0);
  });
});
