import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the knots module
const mockListKnots = vi.fn();
const mockListEdges = vi.fn();
const mockListProfiles = vi.fn();
const mockListWorkflows = vi.fn();

vi.mock("@/lib/knots", () => ({
  listKnots: (...args: unknown[]) => mockListKnots(...args),
  listEdges: (...args: unknown[]) => mockListEdges(...args),
  listProfiles: (...args: unknown[]) => mockListProfiles(...args),
  listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  showKnot: vi.fn().mockResolvedValue({ ok: false, error: "not found" }),
}));

import { KnotsBackend } from "@/lib/backends/knots-backend";

const STUB_PROFILE = {
  id: "autopilot",
  initial_state: "open",
  states: ["open", "shipped"],
  terminal_states: ["shipped"],
  owners: {
    planning: { kind: "agent" },
    plan_review: { kind: "agent" },
    implementation: { kind: "agent" },
    implementation_review: { kind: "agent" },
    shipment: { kind: "agent" },
    shipment_review: { kind: "agent" },
  },
};

function makeKnot(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-abc1",
    title: "Test knot",
    state: "open",
    updated_at: "2026-01-01T00:00:00Z",
    type: "work",
    tags: [],
    profile_id: "autopilot",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListEdges.mockResolvedValue({ ok: true, data: [] });
  mockListProfiles.mockResolvedValue({ ok: true, data: [STUB_PROFILE] });
  mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
});

describe("toBeat alias mapping", () => {
  it("maps non-null alias to beat.alias", async () => {
    mockListKnots.mockResolvedValue({
      ok: true,
      data: [makeKnot({ alias: "my-alias" })],
    });

    const backend = new KnotsBackend();
    const result = await backend.list(undefined, "/tmp/test");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.alias).toBe("my-alias");
  });

  it("maps null alias to undefined on beat", async () => {
    mockListKnots.mockResolvedValue({
      ok: true,
      data: [makeKnot({ alias: null })],
    });

    const backend = new KnotsBackend();
    const result = await backend.list(undefined, "/tmp/test");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.alias).toBeUndefined();
  });

  it("maps missing alias to undefined on beat", async () => {
    mockListKnots.mockResolvedValue({
      ok: true,
      data: [makeKnot()],
    });

    const backend = new KnotsBackend();
    const result = await backend.list(undefined, "/tmp/test");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.alias).toBeUndefined();
  });
});
