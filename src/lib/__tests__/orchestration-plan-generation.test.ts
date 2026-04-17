import { EventEmitter } from "node:events";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockBackendGet = vi.fn();
const mockBackendList = vi.fn();
const mockListDependencies = vi.fn();
const mockGetOrchestrationAgent = vi.fn();
const mockSpawn = vi.fn();
const mockStartInteractionLog = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    get: (...args: unknown[]) => mockBackendGet(...args),
    list: (...args: unknown[]) => mockBackendList(...args),
    listDependencies: (...args: unknown[]) =>
      mockListDependencies(...args),
  }),
}));

vi.mock("@/lib/settings", () => ({
  getOrchestrationAgent: (...args: unknown[]) =>
    mockGetOrchestrationAgent(...args),
}));

vi.mock("@/lib/interaction-logger", () => ({
  startInteractionLog: (...args: unknown[]) =>
    mockStartInteractionLog(...args),
  noopInteractionLog: () => createInteractionLog(),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  generateExecutionPlan,
} from "@/lib/orchestration-plan-generation";

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createInteractionLog() {
  return {
    filePath: "",
    stdoutPath: "",
    stderrPath: "",
    logPrompt: vi.fn(),
    logResponse: vi.fn(),
    logBeatState: vi.fn(),
    logTokenUsage: vi.fn(),
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logEnd: vi.fn(),
  };
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function makeBeat(
  id: string,
  title: string,
  state = "ready_for_implementation",
) {
  return {
    id,
    title,
    description: `Description for ${title}`,
    type: "feature",
    state,
    priority: 1 as const,
    labels: [],
    created: "2026-04-15T00:00:00Z",
    updated: "2026-04-15T00:00:00Z",
  };
}

function taggedPlanJson() {
  return [
    "<orchestration_plan_json>",
    JSON.stringify({
      summary: "Summary",
      waves: [
        {
          wave_index: 1,
          name: "Wave 1",
          objective: "Do work",
          beats: [
            { id: "beat-1", title: "Beat 1" },
            { id: "beat-2", title: "Beat 2" },
          ],
          steps: [
            {
              step_index: 1,
              beat_ids: ["beat-1", "beat-2"],
              notes: "Keep these together.",
            },
          ],
          agents: [{ role: "backend", count: 1 }],
        },
      ],
      unassigned_beat_ids: ["beat-3"],
      assumptions: ["One"],
    }),
    "</orchestration_plan_json>",
  ].join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStartInteractionLog.mockResolvedValue(
    createInteractionLog(),
  );
  mockGetOrchestrationAgent.mockResolvedValue({
    kind: "cli",
    command: "claude",
    model: "claude-sonnet-4.5",
    version: "1.0.0",
  });
  mockBackendList.mockResolvedValue({ ok: true, data: [] });
  mockListDependencies.mockResolvedValue({
    ok: true,
    data: [],
  });
});

describe("generateExecutionPlan", () => {
  it("uses explicit beat selection and returns a plan without scene intake", async () => {
    mockBackendGet.mockImplementation(
      async (beatId: string) => ({
        ok: true,
        data:
          beatId === "beat-1"
            ? makeBeat("beat-1", "Beat 1")
            : makeBeat("beat-2", "Beat 2", "blocked"),
      }),
    );
    mockListDependencies.mockImplementation(
      async (beatId: string) => ({
        ok: true,
        data:
          beatId === "beat-1"
            ? [{ source: "beat-1", target: "beat-2" }]
            : [],
      }),
    );

    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    const promise = generateExecutionPlan({
      repoPath: "/repo",
      beatIds: ["beat-1", "beat-2"],
      objective: "Ship beat-1 then beat-2",
      mode: "groom",
    });

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    const prompt = mockSpawn.mock.calls[0]?.[1]?.[1];
    expect(prompt).toContain(
      "Use the explicit work-item IDs below as the in-scope planning set.",
    );
    expect(prompt).toContain(
      "- beat-1 [feature, ready_for_implementation, P1]: Beat 1",
    );
    expect(prompt).toContain(
      "- beat-2 [feature, blocked, P1]: Beat 2",
    );
    expect(prompt).toContain("- beat-1 blocks beat-2");
    expect(prompt).not.toContain(
      "Infer scope from the objective and inspect beats as needed.",
    );
    expect(mockBackendList).not.toHaveBeenCalled();

    child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: taggedPlanJson() }],
          },
        })}\n`,
      ),
    );
    child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          type: "result",
          result: "done",
        })}\n`,
      ),
    );
    child.emit("close", 0, null);

    await expect(promise).resolves.toMatchObject({
      summary: "Summary",
      waves: [
        {
          waveIndex: 1,
          name: "Wave 1",
          objective: "Do work",
        },
      ],
    });
  });

  it("fails before spawning when any selected beat is missing", async () => {
    mockBackendGet
      .mockResolvedValueOnce({
        ok: true,
        data: makeBeat("beat-1", "Beat 1"),
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { message: "not found" },
      });

    await expect(
      generateExecutionPlan({
        repoPath: "/repo",
        beatIds: ["beat-1", "missing"],
      }),
    ).rejects.toThrow(
      "Missing beats for execution plan generation: missing",
    );

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
