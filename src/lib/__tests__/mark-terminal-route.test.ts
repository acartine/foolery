/**
 * Integration coverage for POST /api/beats/[id]/mark-terminal.
 */
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";
import { NextRequest } from "next/server";
import {
  WORKFLOW_CORRECTION_FAILURE_MARKER,
  WorkflowCorrectionFailureError,
} from "@/lib/workflow-correction-failure";

const mockGet = vi.fn();
const mockMarkTerminal = vi.fn();
const mockRegroomAncestors = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    get: mockGet,
    markTerminal: mockMarkTerminal,
  }),
}));

vi.mock("@/lib/regroom", () => ({
  regroomAncestors: (...args: unknown[]) =>
    mockRegroomAncestors(...args),
}));

import { POST } from
  "@/app/api/beats/[id]/mark-terminal/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    "http://localhost/api/beats/b1/mark-terminal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ ok: true, data: { id: "canonical-id" } });
  mockRegroomAncestors.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/beats/[id]/mark-terminal: happy path", () => {
  it("delegates to backend.markTerminal and runs regroom", async () => {
    mockMarkTerminal.mockResolvedValue({ ok: true });
    const res = await POST(
      makeRequest({ targetState: "shipped", reason: "done" }),
      { params: Promise.resolve({ id: "alias-id" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(mockMarkTerminal).toHaveBeenCalledWith(
      "canonical-id", "shipped", "done", undefined,
    );
    expect(mockRegroomAncestors).toHaveBeenCalledWith(
      "canonical-id", undefined,
    );
  });

  it("passes repoPath through to backend and regroom", async () => {
    mockMarkTerminal.mockResolvedValue({ ok: true });
    await POST(
      makeRequest({
        targetState: "abandoned", _repo: "/tmp/repo",
      }),
      { params: Promise.resolve({ id: "b1" }) },
    );
    expect(mockGet).toHaveBeenCalledWith("b1", "/tmp/repo");
    expect(mockMarkTerminal).toHaveBeenCalledWith(
      "canonical-id", "abandoned", undefined, "/tmp/repo",
    );
    expect(mockRegroomAncestors).toHaveBeenCalledWith(
      "canonical-id", "/tmp/repo",
    );
  });
});

describe("POST /api/beats/[id]/mark-terminal: validation", () => {
  it("returns 400 when targetState is missing", async () => {
    const res = await POST(
      makeRequest({}),
      { params: Promise.resolve({ id: "b1" }) },
    );
    expect(res.status).toBe(400);
    expect(mockMarkTerminal).not.toHaveBeenCalled();
  });

  it("returns 400 and surfaces the FOOLERY WORKFLOW CORRECTION FAILURE marker on bad target", async () => {
    mockMarkTerminal.mockImplementation(() => {
      throw new WorkflowCorrectionFailureError({
        beatId: "canonical-id",
        profileId: "autopilot",
        targetState: "implementation",
        allowedTerminals: ["shipped", "abandoned"],
        reason: "non_terminal_target",
      });
    });
    const res = await POST(
      makeRequest({ targetState: "implementation" }),
      { params: Promise.resolve({ id: "b1" }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toContain(
      WORKFLOW_CORRECTION_FAILURE_MARKER,
    );
    expect(mockRegroomAncestors).not.toHaveBeenCalled();
  });
});
