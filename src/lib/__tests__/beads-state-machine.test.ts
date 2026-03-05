import { describe, expect, it, beforeEach, vi } from "vitest";
import { nextBeat, claimBeat } from "@/lib/beads-state-machine";
import { MockBackendPort } from "@/lib/__tests__/mock-backend-port";

// ── Mock getBackend to return our MockBackendPort ──────────────

const mockBackend = new MockBackendPort();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => mockBackend,
}));

// ── Helper: seed a beat and set its state ──────────────────────

async function seedBeat(state: string, profileId = "autopilot"): Promise<string> {
  const result = await mockBackend.create({
    title: "Test beat",
    type: "work",
    priority: 2,
    labels: [],
    profileId,
  });
  const id = result.data!.id;
  await mockBackend.update(id, { state });
  return id;
}

// ── isExpectedStateMismatchError compat check ──────────────────

function isExpectedStateMismatchError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("expected state") && normalized.includes("currently");
}

// ── Tests ──────────────────────────────────────────────────────

describe("nextBeat", () => {
  beforeEach(() => {
    mockBackend.reset();
  });

  it("advances a beat from its current state to the forward target", async () => {
    const id = await seedBeat("implementation");
    const { nextState } = await nextBeat(id, "implementation");
    expect(nextState).toBe("ready_for_implementation_review");
  });

  it("throws state mismatch when expectedState does not match", async () => {
    const id = await seedBeat("implementation");
    await expect(nextBeat(id, "planning")).rejects.toThrow();
    try {
      await nextBeat(id, "planning");
    } catch (error) {
      expect(isExpectedStateMismatchError((error as Error).message)).toBe(true);
    }
  });

  it("persists the new state via backend update", async () => {
    const id = await seedBeat("planning");
    await nextBeat(id, "planning");
    const result = await mockBackend.get(id);
    expect(result.data!.state).toBe("ready_for_plan_review");
  });

  it("throws when beat does not exist", async () => {
    await expect(nextBeat("nonexistent", "planning")).rejects.toThrow(/not found/i);
  });

  it("throws when no forward transition exists (terminal state)", async () => {
    const id = await seedBeat("shipped");
    await expect(nextBeat(id, "shipped")).rejects.toThrow(/no forward transition/i);
  });

  it("advances through queued-to-active transitions", async () => {
    const id = await seedBeat("ready_for_implementation");
    const { nextState } = await nextBeat(id, "ready_for_implementation");
    expect(nextState).toBe("implementation");
  });

  it("error message is compatible with isExpectedStateMismatchError", async () => {
    const id = await seedBeat("implementation");
    try {
      await nextBeat(id, "shipment");
      expect.fail("should have thrown");
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("expected state");
      expect(msg).toContain("currently");
      expect(isExpectedStateMismatchError(msg)).toBe(true);
    }
  });
});

describe("claimBeat", () => {
  beforeEach(() => {
    mockBackend.reset();
  });

  it("transitions a queued beat to active", async () => {
    const id = await seedBeat("ready_for_implementation");
    const { nextState } = await claimBeat(id);
    expect(nextState).toBe("implementation");
  });

  it("persists the active state via backend update", async () => {
    const id = await seedBeat("ready_for_planning");
    await claimBeat(id);
    const result = await mockBackend.get(id);
    expect(result.data!.state).toBe("planning");
  });

  it("throws when beat is already in an active state", async () => {
    const id = await seedBeat("implementation");
    await expect(claimBeat(id)).rejects.toThrow();
    try {
      await claimBeat(id);
    } catch (error) {
      expect(isExpectedStateMismatchError((error as Error).message)).toBe(true);
    }
  });

  it("throws when beat is in a terminal state", async () => {
    const id = await seedBeat("shipped");
    await expect(claimBeat(id)).rejects.toThrow();
    try {
      await claimBeat(id);
    } catch (error) {
      expect(isExpectedStateMismatchError((error as Error).message)).toBe(true);
    }
  });

  it("throws when beat does not exist", async () => {
    await expect(claimBeat("nonexistent")).rejects.toThrow(/not found/i);
  });

  it("throws when beat is queued but human-owned (not agent-claimable)", async () => {
    // semiauto profile has human-owned plan_review
    const id = await seedBeat("ready_for_plan_review", "semiauto");
    await expect(claimBeat(id)).rejects.toThrow();
    try {
      await claimBeat(id);
    } catch (error) {
      expect(isExpectedStateMismatchError((error as Error).message)).toBe(true);
    }
  });

  it("claims ready_for_shipment to shipment", async () => {
    const id = await seedBeat("ready_for_shipment");
    const { nextState } = await claimBeat(id);
    expect(nextState).toBe("shipment");
  });
});
