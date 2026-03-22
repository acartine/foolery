import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreate = vi.fn();
const mockListWorkflows = vi.fn();
const mockEnqueueBeatScopeRefinement = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    create: (...args: unknown[]) => mockCreate(...args),
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  }),
}));

vi.mock("@/lib/scope-refinement-worker", () => ({
  enqueueBeatScopeRefinement: (...args: unknown[]) => mockEnqueueBeatScopeRefinement(...args),
}));

import { POST } from "@/app/api/beats/route";

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/beats", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/beats scope refinement enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkflows.mockResolvedValue({
      ok: true,
      data: [{ id: "autopilot" }],
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: { id: "foolery-new", title: "New beat" },
    });
    mockEnqueueBeatScopeRefinement.mockResolvedValue(null);
  });

  it("calls enqueueBeatScopeRefinement with the created beat ID after successful creation", async () => {
    const response = await POST(postRequest({ title: "New beat" }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data.id).toBe("foolery-new");
    expect(mockEnqueueBeatScopeRefinement).toHaveBeenCalledWith("foolery-new", undefined);
  });

  it("passes repoPath to enqueueBeatScopeRefinement when provided", async () => {
    const response = await POST(postRequest({ title: "New beat", _repo: "/tmp/repo" }));

    expect(response.status).toBe(201);
    expect(mockEnqueueBeatScopeRefinement).toHaveBeenCalledWith("foolery-new", "/tmp/repo");
  });

  it("does not call enqueueBeatScopeRefinement when beat creation fails", async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      error: { message: "backend error", code: "INTERNAL", retryable: false },
    });

    const response = await POST(postRequest({ title: "New beat" }));

    expect(response.status).toBe(500);
    expect(mockEnqueueBeatScopeRefinement).not.toHaveBeenCalled();
  });

  it("returns 201 even if enqueueBeatScopeRefinement throws", async () => {
    mockEnqueueBeatScopeRefinement.mockRejectedValue(new Error("queue boom"));

    const response = await POST(postRequest({ title: "New beat" }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data.id).toBe("foolery-new");
  });
});
