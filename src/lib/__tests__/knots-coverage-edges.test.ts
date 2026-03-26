/**
 * Coverage tests for src/lib/knots.ts: edges, profiles, workflows,
 * pendingWriteCount, and exec error handling.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type ExecFileCallback = (
  error: (NodeJS.ErrnoException & { killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

let responseQueue: Array<{
  stdout?: string;
  stderr?: string;
  error?: (NodeJS.ErrnoException & { killed?: boolean }) | null;
}> = [];

const execFileCallArgs: Array<string[]> = [];

vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: Record<string, unknown>,
    callback: ExecFileCallback,
  ) => {
    execFileCallArgs.push(args);
    const response = responseQueue.shift() ?? {};
    queueMicrotask(() => {
      callback(
        response.error ?? null,
        response.stdout ?? "",
        response.stderr ?? "",
      );
    });
  },
}));

import {
  listEdges,
  addEdge,
  removeEdge,
  listProfiles,
  listWorkflows,
  showKnot,
  _pendingWriteCount,
} from "@/lib/knots";
import type {
  KnotProfileDefinition,
  KnotWorkflowDefinition,
  KnotEdge,
} from "@/lib/knots";

beforeEach(() => {
  vi.clearAllMocks();
  responseQueue = [];
  execFileCallArgs.length = 0;
});

describe("listEdges", () => {
  it("parses successful output", async () => {
    const edges: KnotEdge[] = [{ src: "1", kind: "blocks", dst: "2" }];
    responseQueue.push({ stdout: JSON.stringify(edges) });
    const result = await listEdges("1", "both", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(edges);
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "edge err",
    });
    const result = await listEdges("1", "incoming", "/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "bad" });
    const result = await listEdges("1", "outgoing", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("defaults to both direction", async () => {
    responseQueue.push({ stdout: "[]" });
    await listEdges("1", undefined, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--direction");
    expect(callArgs).toContain("both");
  });
});

describe("addEdge", () => {
  it("succeeds on zero exit", async () => {
    responseQueue.push({});
    const result = await addEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "add err",
    });
    const result = await addEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(false);
  });
});

describe("removeEdge", () => {
  it("succeeds on zero exit", async () => {
    responseQueue.push({});
    const result = await removeEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "rm err",
    });
    const result = await removeEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(false);
  });
});

describe("listProfiles: parsing and fallback", () => {
  it("parses successful profile list output", async () => {
    const profiles: KnotProfileDefinition[] = [
      {
        id: "autopilot",
        owners: {
          planning: { kind: "agent" },
          plan_review: { kind: "agent" },
          implementation: { kind: "agent" },
          implementation_review: { kind: "agent" },
          shipment: { kind: "agent" },
          shipment_review: { kind: "agent" },
        },
        initial_state: "ready_for_planning",
        states: ["ready_for_planning", "planning"],
        terminal_states: ["shipped"],
      },
    ];
    responseQueue.push({ stdout: JSON.stringify(profiles) });
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("autopilot");
  });

  it("falls back to profile ls on primary failure", async () => {
    const profiles: KnotProfileDefinition[] = [
      {
        id: "fallback",
        owners: {
          planning: { kind: "agent" },
          plan_review: { kind: "agent" },
          implementation: { kind: "agent" },
          implementation_review: { kind: "agent" },
          shipment: { kind: "agent" },
          shipment_review: { kind: "agent" },
        },
        initial_state: "open",
        states: ["open"],
        terminal_states: ["closed"],
      },
    ];
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(profiles) });
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("fallback");
  });

  it("falls back to workflow list when both profile commands fail", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      {
        id: "wf-fallback", initial_state: "open",
        states: ["open", "closed"], terminal_states: ["closed"],
      },
    ];
    responseQueue.push({
      error: {
        name: "Error", message: "fail1",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({
      error: {
        name: "Error", message: "fail2",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(workflows) });
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("wf-fallback");
  });

  it("returns error when all fallbacks fail", async () => {
    const mkErr = () => ({
      error: {
        name: "Error", message: "f",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "err",
    });
    responseQueue.push(mkErr());
    responseQueue.push(mkErr());
    responseQueue.push(mkErr());
    responseQueue.push(mkErr());
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
  });
});

describe("listProfiles: error handling", () => {
  it("returns error on invalid JSON in primary", async () => {
    responseQueue.push({ stdout: "bad json" });
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("returns error on invalid JSON in fallback ls", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "f1",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "bad json too" });
    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

describe("listWorkflows", () => {
  it("parses successful output", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      {
        id: "wf1", initial_state: "open",
        states: ["open"], terminal_states: ["closed"],
      },
    ];
    responseQueue.push({ stdout: JSON.stringify(workflows) });
    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("wf1");
  });

  it("falls back to workflow ls on primary failure", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      {
        id: "wf-fb", initial_state: "open",
        states: ["open"], terminal_states: ["closed"],
      },
    ];
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(workflows) });
    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error when both variants fail", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "f1",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "e1",
    });
    responseQueue.push({
      error: {
        name: "Error", message: "f2",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "e2",
    });
    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "bad" });
    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("returns error on invalid JSON in fallback", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "f1",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "also bad" });
    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

describe("_pendingWriteCount", () => {
  it("returns 0 when no writes are pending", () => {
    expect(_pendingWriteCount("/some/path")).toBe(0);
  });
});

describe("exec error handling", () => {
  it("handles killed process (timeout)", async () => {
    const error = new Error("killed") as NodeJS.ErrnoException & {
      killed: boolean;
    };
    error.killed = true;
    error.code = "SIGKILL";
    responseQueue.push({ error, stderr: "original stderr" });
    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
  });

  it("handles error with no stderr", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "",
    });
    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
  });
});
