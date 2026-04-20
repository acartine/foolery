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

const OPEN_BEATS: Beat[] = [
  makeBeat({
    id: "foolery-blocker",
    aliases: ["alias-blocker"],
    title: "Blocker",
  }),
  makeBeat({
    id: "foolery-gate-agent",
    title: "Agent-owned gate",
    type: "gate",
    nextActionOwnerKind: "agent",
    isAgentClaimable: true,
  }),
  makeBeat({
    id: "foolery-gate-human",
    title: "Human-owned gate",
    type: "gate",
    nextActionOwnerKind: "human",
    requiresHumanAction: true,
    isAgentClaimable: false,
  }),
];

const BLOCKED_BEATS: Beat[] = [
  makeBeat({
    id: "foolery-blocked",
    title: "Blocked beat",
    state: "blocked",
  }),
];

function listBeats(filters?: { state?: string }) {
  if (filters?.state === "open") {
    return ok<Beat[]>(OPEN_BEATS);
  }
  if (filters?.state === "blocked") {
    return ok<Beat[]>(BLOCKED_BEATS);
  }
  return ok<Beat[]>([]);
}

function listDependencies(id: string) {
  if (id === "foolery-blocked") {
    return ok<BeatDependency[]>([
      {
        id: "foolery-blocker",
        dependency_type: "blocks",
      },
    ]);
  }
  return ok<BeatDependency[]>([]);
}

describe("GET /api/waves aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkflows.mockResolvedValue(ok<MemoryWorkflowDescriptor[]>([]));
    mockList.mockImplementation(async (filters?: { state?: string }) => listBeats(filters));
    mockListDependencies.mockImplementation(async (id: string) => listDependencies(id));
  });

  it("uses blocker aliases in blocked readiness reasons", async () => {
    const response = await GET(new NextRequest("http://localhost/api/waves"));
    const json = await response.json();
    const blockedBeat = json.data.waves
      .flatMap((wave: {
        beats: Array<{
          id: string;
          readinessReason: string;
          aliases?: string[];
        }>;
      }) => wave.beats)
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

  it("keeps agent-owned gate beats runnable in the wave list", async () => {
    const response = await GET(new NextRequest("http://localhost/api/waves"));
    const json = await response.json();
    const agentGate = json.data.waves
      .flatMap((wave: {
        beats: Array<{
          id: string;
          type: string;
          readiness: string;
        }>;
        gate?: { id: string };
      }) => wave.beats)
      .find((beat: { id: string }) => beat.id === "foolery-gate-agent");

    expect(agentGate).toMatchObject({
      id: "foolery-gate-agent",
      type: "gate",
      readiness: "runnable",
    });
    expect(
      json.data.waves.some((wave: { gate?: { id: string } }) =>
        wave.gate?.id === "foolery-gate-agent"),
    ).toBe(false);
  });

  it("marks human-owned gate beats as escalations", async () => {
    const response = await GET(new NextRequest("http://localhost/api/waves"));
    const json = await response.json();
    const humanGate = json.data.waves
      .flatMap((wave: {
        beats: Array<{
          id: string;
          readiness: string;
          readinessReason: string;
        }>;
      }) => wave.beats)
      .find((beat: { id: string }) => beat.id === "foolery-gate-human");

    expect(humanGate).toMatchObject({
      id: "foolery-gate-human",
      readiness: "humanAction",
      readinessReason: "Awaiting human approval for this gate.",
    });
  });
});
