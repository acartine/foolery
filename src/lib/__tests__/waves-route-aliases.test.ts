import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";

const mockList = vi.fn();
const mockListDependencies = vi.fn();
const mockListWorkflows = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    list: (...args: unknown[]) => mockList(...args),
    listDependencies: (...args: unknown[]) => mockListDependencies(...args),
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  }),
}));

import { GET } from "@/app/api/waves/route";

function makeBeat(overrides: Partial<Beat>): Beat {
  return {
    id: "foolery-default",
    title: "Default beat",
    type: "work",
    state: "open",
    priority: 2,
    labels: [],
    created: "2026-03-10T00:00:00Z",
    updated: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

function ok<T>(data: T) {
  return { ok: true, data };
}

describe("GET /api/waves aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkflows.mockResolvedValue(ok<MemoryWorkflowDescriptor[]>([]));
    mockList.mockImplementation(async (filters?: { state?: string }) => {
      if (filters?.state === "open") {
        return ok<Beat[]>([
          makeBeat({
            id: "foolery-blocker",
            aliases: ["alias-blocker"],
            title: "Blocker",
          }),
        ]);
      }

      if (filters?.state === "blocked") {
        return ok<Beat[]>([
          makeBeat({
            id: "foolery-blocked",
            title: "Blocked beat",
            state: "blocked",
          }),
        ]);
      }

      return ok<Beat[]>([]);
    });
    mockListDependencies.mockImplementation(async (id: string) => {
      if (id === "foolery-blocked") {
        return ok<BeatDependency[]>([
          {
            id: "foolery-blocker",
            dependency_type: "blocks",
          },
        ]);
      }
      return ok<BeatDependency[]>([]);
    });
  });

  it("uses blocker aliases in blocked readiness reasons", async () => {
    const response = await GET(new NextRequest("http://localhost/api/waves"));
    const json = await response.json();
    const blockedBeat = json.data.waves
      .flatMap((wave: { beats: Array<{ id: string; readinessReason: string; aliases?: string[] }> }) => wave.beats)
      .find((beat: { id: string }) => beat.id === "foolery-blocked");

    expect(blockedBeat).toMatchObject({
      id: "foolery-blocked",
      readinessReason: "Waiting on alias-blocker",
    });
  });

  it("passes aliases through on wave beats for the planner view", async () => {
    const response = await GET(new NextRequest("http://localhost/api/waves"));
    const json = await response.json();
    const blockerBeat = json.data.waves
      .flatMap((wave: { beats: Array<{ id: string; aliases?: string[] }> }) => wave.beats)
      .find((beat: { id: string }) => beat.id === "foolery-blocker");

    expect(blockerBeat?.aliases).toEqual(["alias-blocker"]);
  });
});
