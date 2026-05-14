import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

const mockListWorkflows = vi.fn();
const mockCreate = vi.fn();
const mockLoadSettings = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  }),
}));

vi.mock("@/lib/settings", () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
}));

vi.mock("@/lib/scope-refinement-worker", () => ({
  enqueueBeatScopeRefinement: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/beats/route";

function descriptor(
  id: string,
  overrides: Partial<MemoryWorkflowDescriptor> = {},
): MemoryWorkflowDescriptor {
  return {
    id,
    backingWorkflowId: id,
    label: id,
    mode: "granular_autonomous",
    initialState: "ready_for_implementation",
    states: ["ready_for_implementation", "implementation", "shipped"],
    terminalStates: ["shipped"],
    finalCutState: null,
    retakeState: "ready_for_implementation",
    promptProfileId: id,
    profileId: id,
    ...overrides,
  };
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/beats", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function settingsWithProfile(profileId: string) {
  return { defaults: { profileId } };
}

describe("POST /api/beats default profile resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ ok: true, data: { id: "beat-1" } });
  });

  it(
    "applies the saved default profile when neither profileId nor "
    + "workflowId is supplied",
    async () => {
      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [descriptor("autopilot"), descriptor("semiauto")],
      });
      mockLoadSettings.mockResolvedValue(settingsWithProfile("semiauto"));

      const response = await POST(postRequest({ title: "New beat" }));
      expect(response.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: "semiauto" }),
        undefined,
      );
    },
  );

  it(
    "falls back to the first live workflow when the saved default no "
    + "longer matches a live profile",
    async () => {
      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [
          descriptor("custom_a"),
          descriptor("custom_b"),
        ],
      });
      mockLoadSettings.mockResolvedValue(
        settingsWithProfile("removed_profile"),
      );

      const response = await POST(postRequest({ title: "Stale default" }));
      expect(response.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: "custom_a" }),
        undefined,
      );
    },
  );

  it(
    "does not consult settings when the caller supplies a profileId",
    async () => {
      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [descriptor("autopilot"), descriptor("semiauto")],
      });
      mockLoadSettings.mockResolvedValue(settingsWithProfile("semiauto"));

      await POST(postRequest({ title: "Explicit", profileId: "autopilot" }));
      expect(mockLoadSettings).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: "autopilot" }),
        undefined,
      );
    },
  );

  it(
    "falls back to the first live workflow when settings cannot be loaded",
    async () => {
      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [descriptor("first_listed"), descriptor("second")],
      });
      mockLoadSettings.mockRejectedValue(new Error("settings unavailable"));

      const response = await POST(
        postRequest({ title: "Settings load fail" }),
      );
      expect(response.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: "first_listed" }),
        undefined,
      );
    },
  );

  it("rejects an explicit profileId that the backend does not expose", async () => {
    mockListWorkflows.mockResolvedValue({
      ok: true,
      data: [descriptor("autopilot")],
    });
    mockLoadSettings.mockResolvedValue(settingsWithProfile(""));

    const response = await POST(
      postRequest({ title: "Bad profile", profileId: "unknown_one" }),
    );
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
