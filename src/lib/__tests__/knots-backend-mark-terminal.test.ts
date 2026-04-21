/**
 * Coverage for the descriptive correction path on KnotsBackend:
 * markTerminal + reopen. Mirrors the plumbing in knots-backend-state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  store,
  resetStore,
  nowIso,
  mockUpdateKnot,
} from "./knots-backend-mocks";
import {
  WORKFLOW_CORRECTION_FAILURE_MARKER,
} from "@/lib/workflow-correction-failure";

vi.mock("@/lib/knots", async () =>
  (await import("./knots-backend-mocks")).buildMockModule(),
);

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function seedBeat(id: string, state: string) {
  const now = nowIso();
  store.knots.set(id, {
    id,
    title: `Beat ${id}`,
    state,
    profile_id: "autopilot",
    workflow_id: "autopilot",
    updated_at: now,
    body: null,
    description: null,
    priority: 2,
    type: "task",
    tags: [],
    notes: [],
    handoff_capsules: [],
    workflow_etag: `etag-${id}`,
    created_at: now,
  });
}

describe("markTerminal", () => {
  it("sets force=true when the target is a profile terminal", async () => {
    const backend = new KnotsBackend("/repo");
    seedBeat("mt-1", "ready_for_implementation");
    const result = await backend.markTerminal("mt-1", "shipped");
    expect(result.ok).toBe(true);
    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall![1]).toMatchObject({
      status: "shipped",
      force: true,
    });
  });

  it("prefixes correction notes with 'Correction:'", async () => {
    const backend = new KnotsBackend("/repo");
    seedBeat("mt-note", "implementation");
    await backend.markTerminal(
      "mt-note", "shipped", "regression patched",
    );
    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall![1]).toMatchObject({
      addNote: "Correction: regression patched",
    });
  });

  it(
    "throws a WorkflowCorrectionFailureError with the greppable marker "
    + "on non-terminal target",
    async () => {
      const backend = new KnotsBackend("/repo");
      seedBeat("mt-bad", "ready_for_implementation");
      await expect(
        backend.markTerminal("mt-bad", "implementation"),
      ).rejects.toThrow(WORKFLOW_CORRECTION_FAILURE_MARKER);
    },
  );

  it("does not call updateKnot when the target is non-terminal", async () => {
    const backend = new KnotsBackend("/repo");
    seedBeat("mt-bad2", "ready_for_implementation");
    mockUpdateKnot.mockClear();
    await expect(
      backend.markTerminal("mt-bad2", "implementation"),
    ).rejects.toThrow();
    expect(mockUpdateKnot).not.toHaveBeenCalled();
  });
});

describe("close() delegates to markTerminal", () => {
  it("forces to shipped through the same kno update path", async () => {
    const backend = new KnotsBackend("/repo");
    seedBeat("c-1", "ready_for_shipment_review");
    const result = await backend.close("c-1", "all good");
    expect(result.ok).toBe(true);
    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall![1]).toMatchObject({
      status: "shipped",
      force: true,
      addNote: "Correction: all good",
    });
  });
});

describe("reopen", () => {
  it("forces state back to the profile's retakeState", async () => {
    const backend = new KnotsBackend("/repo");
    seedBeat("r-1", "shipped");
    const result = await backend.reopen("r-1", "regressed");
    expect(result.ok).toBe(true);
    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    const payload = lastCall![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      force: true,
      addNote: "Retake: regressed",
    });
    // retakeState comes from the profile descriptor derived by the
    // mock; exact value varies with queue_actions shape.
    expect(typeof payload.status).toBe("string");
    expect(String(payload.status)).not.toBe("shipped");
  });
});
