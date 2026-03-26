import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const mockGet = vi.fn();
const mockEnqueue = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: mockGet }),
}));

vi.mock("@/lib/scope-refinement-worker", () => ({
  enqueueBeatScopeRefinement: (
    ...args: unknown[]
  ) => mockEnqueue(...args),
}));

import { POST } from
  "@/app/api/beats/[id]/refine-scope/route";

function makeRequest(
  body: Record<string, unknown>,
): NextRequest {
  return new NextRequest(
    "http://localhost/api/beats/b1/refine-scope",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function setupRefineScopeMocks() {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({
    ok: true,
    data: { id: "canonical-id" },
  });
}

describe(
  "POST refine-scope: enqueue and routing",
  () => {
    beforeEach(setupRefineScopeMocks);

      it("enqueues refinement with canonical id",
        async () => {
        mockEnqueue.mockResolvedValue({
          id: "job-1",
          beatId: "canonical-id",
        });

        const res = await POST(
          makeRequest({}),
          {
            params: Promise.resolve({
              id: "alias-id",
            }),
          },
        );
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({
          ok: true,
          data: {
            jobId: "job-1",
            beatId: "canonical-id",
          },
        });
        expect(mockEnqueue).toHaveBeenCalledWith(
          "canonical-id",
          undefined,
        );
      });

    it("passes repo path through", async () => {
      mockEnqueue.mockResolvedValue({
        id: "job-2",
        beatId: "canonical-id",
      });

      await POST(
        makeRequest({ _repo: "/tmp/repo" }),
        {
          params: Promise.resolve({
            id: "b1",
          }),
        },
      );

      expect(mockGet).toHaveBeenCalledWith(
        "b1",
        "/tmp/repo",
      );
      expect(mockEnqueue).toHaveBeenCalledWith(
        "canonical-id",
        "/tmp/repo",
      );
    });

  },
);

describe(
  "POST refine-scope: error handling",
  () => {
    beforeEach(setupRefineScopeMocks);

      it("returns 503 when no agent configured",
        async () => {
        mockEnqueue.mockResolvedValue(null);

        const res = await POST(
          makeRequest({}),
          {
            params: Promise.resolve({
              id: "b1",
            }),
          },
        );

        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json.error).toMatch(
          /not configured/i,
        );
      });

    it("falls back to provided id on lookup miss",
      async () => {
        mockGet.mockResolvedValue({
          ok: false,
          error: { message: "Not found" },
        });
        mockEnqueue.mockResolvedValue({
          id: "job-3",
          beatId: "raw-id",
        });

        const res = await POST(
          makeRequest({}),
          {
            params: Promise.resolve({
              id: "raw-id",
            }),
          },
        );
        const json = await res.json();

        expect(json.data.beatId).toBe("raw-id");
        expect(mockEnqueue).toHaveBeenCalledWith(
          "raw-id",
          undefined,
        );
      });
  },
);
