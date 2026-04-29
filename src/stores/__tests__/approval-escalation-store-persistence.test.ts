import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalEscalation } from "@/lib/approval-escalations";
import {
  selectPendingApprovals,
  useApprovalEscalationStore,
} from "@/stores/approval-escalation-store";

function makeApproval(
  id: string,
  overrides: Partial<ApprovalEscalation> = {},
): ApprovalEscalation {
  return {
    id,
    notificationKey: id,
    logicalKey: id,
    status: "pending",
    sessionId: "term-1",
    beatId: "beat-1",
    repoPath: "/Users/cartine/foolery",
    adapter: "opencode",
    source: "permission.asked",
    options: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("approval store survives terminal lifecycle", () => {
  beforeEach(() => {
    useApprovalEscalationStore.setState({ approvals: [] });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps pending approval even when its terminal session is gone", () => {
    const store = useApprovalEscalationStore.getState();
    store.upsertPendingApproval(makeApproval("orphan-1", {
      sessionId: "term-removed",
    }));
    // Simulating terminal-store removeTerminal would only touch the
    // terminal store, never this store. The approval must still be
    // present and pending.
    expect(selectPendingApprovals(
      useApprovalEscalationStore.getState(),
    )).toHaveLength(1);
  });

  it("only removes approvals on explicit user actions", () => {
    const store = useApprovalEscalationStore.getState();
    store.upsertPendingApproval(makeApproval("approve-1"));
    store.upsertPendingApproval(makeApproval("dismiss-1"));
    store.upsertPendingApproval(makeApproval("manual-1"));

    store.markApprovalResolved("approve-1", "approve");
    store.dismissApproval("dismiss-1");
    store.markManualAction("manual-1");

    const pending = selectPendingApprovals(
      useApprovalEscalationStore.getState(),
    );
    // Manual action keeps the row visible, approve/dismiss remove.
    expect(pending.map((a) => a.id)).toEqual(["manual-1"]);
  });
});
