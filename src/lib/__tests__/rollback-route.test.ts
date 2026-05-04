import {
  beforeEach, describe, expect, it, vi,
} from "vitest";
import { NextRequest } from "next/server";

const mockGet = vi.fn();
const mockResolveMemoryManagerType = vi.fn();
const mockRollbackBeatState = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: mockGet }),
}));

vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: (...args: unknown[]) =>
    mockResolveMemoryManagerType(...args),
  rollbackBeatState: (...args: unknown[]) =>
    mockRollbackBeatState(...args),
}));

import { POST } from
  "@/app/api/beats/[id]/rollback/route";

function makeRequest(
  body: Record<string, unknown>,
): NextRequest {
  return new NextRequest(
    "http://localhost/api/beats/b1/rollback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({
    ok: true,
    data: { id: "canonical-id", state: "implementation" },
  });
  mockResolveMemoryManagerType.mockReturnValue("knots");
  mockRollbackBeatState.mockResolvedValue(undefined);
});

describe("POST /api/beats/[id]/rollback", () => {
  it("rolls back the canonical beat in the requested repo scope", async () => {
    const res = await POST(
      makeRequest({
        _repo: "/tmp/repo",
        reason: "release",
      }),
      { params: Promise.resolve({ id: "alias-id" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockGet).toHaveBeenCalledWith("alias-id", "/tmp/repo");
    expect(mockResolveMemoryManagerType).toHaveBeenCalledWith(
      "/tmp/repo",
    );
    expect(mockRollbackBeatState).toHaveBeenCalledWith(
      "canonical-id",
      "implementation",
      "unknown",
      "/tmp/repo",
      "knots",
      "release",
    );
  });

  it("rejects non-Knots repositories without mutating state", async () => {
    mockResolveMemoryManagerType.mockReturnValue("beads");

    const res = await POST(
      makeRequest({ _repo: "/tmp/repo" }),
      { params: Promise.resolve({ id: "b1" }) },
    );

    expect(res.status).toBe(400);
    expect(mockRollbackBeatState).not.toHaveBeenCalled();
  });

  it("surfaces backend lookup failures before rollback", async () => {
    mockGet.mockResolvedValue({
      ok: false,
      error: { message: "missing", code: "NOT_FOUND" },
    });

    const res = await POST(
      makeRequest({}),
      { params: Promise.resolve({ id: "b1" }) },
    );

    expect(res.status).toBe(404);
    expect(mockRollbackBeatState).not.toHaveBeenCalled();
  });
});
