/**
 * Coverage tests for src/lib/knots.ts.
 * Targets uncovered lines: 41-446, 461-492.
 *
 * Since knots.ts wraps a CLI binary (kno), we mock node:child_process
 * to simulate CLI responses and exercise all code paths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock child_process.execFile ─────────────────────────────

type ExecFileCallback = (
  error: (NodeJS.ErrnoException & { killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Queued responses for execFileMock. Each call to execFile pops the
 * next response from this queue and immediately invokes the callback.
 */
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
    // Use queueMicrotask to allow withWriteSerialization promise chain to settle
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
  listKnots,
  listProfiles,
  listWorkflows,
  showKnot,
  newKnot,
  claimKnot,
  pollKnot,
  updateKnot,
  listEdges,
  addEdge,
  removeEdge,
  _pendingWriteCount,
} from "@/lib/knots";
import type {
  KnotRecord,
  KnotProfileDefinition,
  KnotWorkflowDefinition,
  KnotClaimPrompt,
  KnotEdge,
} from "@/lib/knots";

beforeEach(() => {
  vi.clearAllMocks();
  responseQueue = [];
  execFileCallArgs.length = 0;
});

// ── listKnots ───────────────────────────────────────────────

describe("listKnots", () => {
  it("parses successful --all output", async () => {
    const records: KnotRecord[] = [
      { id: "1", title: "Test", state: "open", updated_at: "2026-01-01T00:00:00Z" },
    ];
    responseQueue.push({ stdout: JSON.stringify(records) });

    const result = await listKnots("/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(records);
  });

  it("falls back to ls without --all on failure", async () => {
    const records: KnotRecord[] = [
      { id: "2", title: "Fallback", state: "open", updated_at: "2026-01-01T00:00:00Z" },
    ];
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(records) });

    const result = await listKnots("/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(records);
  });

  it("returns error when both ls variants fail", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({
      error: { name: "Error", message: "fail2", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "both failed",
    });

    const result = await listKnots("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error on invalid JSON output", async () => {
    responseQueue.push({ stdout: "not json" });

    const result = await listKnots("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("returns error on invalid JSON in fallback", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "bad json" });

    const result = await listKnots("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── showKnot ────────────────────────────────────────────────

describe("showKnot", () => {
  it("parses successful output", async () => {
    const record: KnotRecord = { id: "42", title: "Detail", state: "open", updated_at: "2026-01-01T00:00:00Z" };
    responseQueue.push({ stdout: JSON.stringify(record) });

    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("42");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "not found",
    });

    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "bad" });

    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── newKnot ─────────────────────────────────────────────────

describe("newKnot", () => {
  it("parses created ID from output", async () => {
    responseQueue.push({ stdout: "created 5678" });

    const result = await newKnot("New Title", {}, "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("5678");
  });

  it("passes description option", async () => {
    responseQueue.push({ stdout: "created 100" });

    await newKnot("Title", { description: "My desc" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--desc");
    expect(callArgs).toContain("My desc");
  });

  it("passes body as description", async () => {
    responseQueue.push({ stdout: "created 101" });

    await newKnot("Title", { body: "Body text" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--desc");
    expect(callArgs).toContain("Body text");
  });

  it("passes state option", async () => {
    responseQueue.push({ stdout: "created 102" });

    await newKnot("Title", { state: "open" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--state");
    expect(callArgs).toContain("open");
  });

  it("passes profile option", async () => {
    responseQueue.push({ stdout: "created 103" });

    await newKnot("Title", { profile: "semiauto" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--profile");
    expect(callArgs).toContain("semiauto");
  });

  it("passes workflow as profile option", async () => {
    responseQueue.push({ stdout: "created 104" });

    await newKnot("Title", { workflow: "autopilot" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--profile");
    expect(callArgs).toContain("autopilot");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "err",
    });

    const result = await newKnot("Title", {}, "/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error if output does not match expected format", async () => {
    responseQueue.push({ stdout: "no match here" });

    const result = await newKnot("Title", {}, "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── claimKnot ───────────────────────────────────────────────

describe("claimKnot", () => {
  it("parses successful claim output", async () => {
    const claimPrompt: KnotClaimPrompt = {
      id: "42",
      title: "Claim Test",
      state: "open",
      profile_id: "autopilot",
      prompt: "Do the thing",
    };
    responseQueue.push({ stdout: JSON.stringify(claimPrompt) });

    const result = await claimKnot("42", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("42");
  });

  it("passes agent options", async () => {
    responseQueue.push({
      stdout: JSON.stringify({ id: "42", title: "T", state: "open", profile_id: "a", prompt: "p" }),
    });

    await claimKnot("42", "/repo", {
      agentName: "claude",
      agentModel: "opus",
      agentVersion: "1.0",
    });
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--agent-name");
    expect(callArgs).toContain("claude");
    expect(callArgs).toContain("--agent-model");
    expect(callArgs).toContain("opus");
    expect(callArgs).toContain("--agent-version");
    expect(callArgs).toContain("1.0");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "claim err",
    });

    const result = await claimKnot("42", "/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "not json" });

    const result = await claimKnot("42", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── pollKnot ────────────────────────────────────────────────

describe("pollKnot", () => {
  it("parses successful poll output", async () => {
    const claimPrompt: KnotClaimPrompt = {
      id: "99",
      title: "Poll Test",
      state: "open",
      profile_id: "autopilot",
      prompt: "Do polling",
    };
    responseQueue.push({ stdout: JSON.stringify(claimPrompt) });

    const result = await pollKnot("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("99");
  });

  it("passes stage and agent options", async () => {
    responseQueue.push({
      stdout: JSON.stringify({ id: "99", title: "T", state: "open", profile_id: "a", prompt: "p" }),
    });

    await pollKnot("/repo", {
      stage: "implementation",
      agentName: "claude",
      agentModel: "opus",
      agentVersion: "2.0",
    });
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("implementation");
    expect(callArgs).toContain("--agent-name");
    expect(callArgs).toContain("--agent-model");
    expect(callArgs).toContain("--agent-version");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "poll err",
    });

    const result = await pollKnot("/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "bad" });

    const result = await pollKnot("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── updateKnot ──────────────────────────────────────────────

describe("updateKnot", () => {
  it("succeeds with all options", async () => {
    responseQueue.push({});

    const result = await updateKnot(
      "42",
      {
        title: "New Title",
        description: "New desc",
        priority: 1,
        status: "closed",
        type: "bug",
        addTags: ["tag1", "tag2"],
        removeTags: ["old-tag"],
        addNote: "A note",
        noteUsername: "user1",
        noteDatetime: "2026-01-01",
        noteAgentname: "claude",
        noteModel: "opus",
        noteVersion: "1.0",
        addHandoffCapsule: "Capsule text",
        handoffUsername: "user2",
        handoffDatetime: "2026-01-02",
        handoffAgentname: "agent2",
        handoffModel: "model2",
        handoffVersion: "2.0",
        force: true,
      },
      "/repo",
    );
    expect(result.ok).toBe(true);

    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--title");
    expect(callArgs).toContain("--description");
    expect(callArgs).toContain("--priority");
    expect(callArgs).toContain("--status");
    expect(callArgs).toContain("--type");
    expect(callArgs).toContain("--add-tag");
    expect(callArgs).toContain("--remove-tag");
    expect(callArgs).toContain("--add-note");
    expect(callArgs).toContain("--note-username");
    expect(callArgs).toContain("--note-datetime");
    expect(callArgs).toContain("--note-agentname");
    expect(callArgs).toContain("--note-model");
    expect(callArgs).toContain("--note-version");
    expect(callArgs).toContain("--add-handoff-capsule");
    expect(callArgs).toContain("--handoff-username");
    expect(callArgs).toContain("--handoff-datetime");
    expect(callArgs).toContain("--handoff-agentname");
    expect(callArgs).toContain("--handoff-model");
    expect(callArgs).toContain("--handoff-version");
    expect(callArgs).toContain("--force");
  });

  it("skips empty tag strings", async () => {
    responseQueue.push({});

    await updateKnot("42", { addTags: ["", "  ", "valid"] }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    const addTagIndices = callArgs.reduce<number[]>((acc, arg, i) => {
      if (arg === "--add-tag") acc.push(i);
      return acc;
    }, []);
    expect(addTagIndices.length).toBe(1);
    expect(callArgs[addTagIndices[0]! + 1]).toBe("valid");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "update err",
    });

    const result = await updateKnot("42", { title: "T" }, "/repo");
    expect(result.ok).toBe(false);
  });

  it("handles minimal update with no options", async () => {
    responseQueue.push({});

    const result = await updateKnot("42", {}, "/repo");
    expect(result.ok).toBe(true);
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("update");
    expect(callArgs).toContain("42");
  });
});

// ── listEdges ───────────────────────────────────────────────

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
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
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

// ── addEdge ─────────────────────────────────────────────────

describe("addEdge", () => {
  it("succeeds on zero exit", async () => {
    responseQueue.push({});

    const result = await addEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "add err",
    });

    const result = await addEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(false);
  });
});

// ── removeEdge ──────────────────────────────────────────────

describe("removeEdge", () => {
  it("succeeds on zero exit", async () => {
    responseQueue.push({});

    const result = await removeEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "rm err",
    });

    const result = await removeEdge("1", "blocks", "2", "/repo");
    expect(result.ok).toBe(false);
  });
});

// ── listProfiles ────────────────────────────────────────────

describe("listProfiles", () => {
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
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(profiles) });

    const result = await listProfiles("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("fallback");
  });

  it("falls back to workflow list when both profile commands fail", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      {
        id: "wf-fallback",
        initial_state: "open",
        states: ["open", "closed"],
        terminal_states: ["closed"],
      },
    ];
    // profile list fails
    responseQueue.push({
      error: { name: "Error", message: "fail1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    // profile ls fails
    responseQueue.push({
      error: { name: "Error", message: "fail2", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    // workflow list succeeds
    responseQueue.push({ stdout: JSON.stringify(workflows) });

    const result = await listProfiles("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("wf-fallback");
  });

  it("returns error when all fallbacks fail", async () => {
    // profile list fails
    responseQueue.push({
      error: { name: "Error", message: "f1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "err1",
    });
    // profile ls fails
    responseQueue.push({
      error: { name: "Error", message: "f2", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "err2",
    });
    // workflow list fails
    responseQueue.push({
      error: { name: "Error", message: "f3", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "err3",
    });
    // workflow ls fails
    responseQueue.push({
      error: { name: "Error", message: "f4", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "err4",
    });

    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON in primary", async () => {
    responseQueue.push({ stdout: "bad json" });

    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("returns error on invalid JSON in fallback ls", async () => {
    responseQueue.push({
      error: { name: "Error", message: "f1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "bad json too" });

    const result = await listProfiles("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── listWorkflows ───────────────────────────────────────────

describe("listWorkflows", () => {
  it("parses successful output", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      { id: "wf1", initial_state: "open", states: ["open"], terminal_states: ["closed"] },
    ];
    responseQueue.push({ stdout: JSON.stringify(workflows) });

    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.id).toBe("wf1");
  });

  it("falls back to workflow ls on primary failure", async () => {
    const workflows: KnotWorkflowDefinition[] = [
      { id: "wf-fb", initial_state: "open", states: ["open"], terminal_states: ["closed"] },
    ];
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(workflows) });

    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(true);
  });

  it("returns error when both variants fail", async () => {
    responseQueue.push({
      error: { name: "Error", message: "f1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "e1",
    });
    responseQueue.push({
      error: { name: "Error", message: "f2", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
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
      error: { name: "Error", message: "f1", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "also bad" });

    const result = await listWorkflows("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

// ── _pendingWriteCount ──────────────────────────────────────

describe("_pendingWriteCount", () => {
  it("returns 0 when no writes are pending", () => {
    expect(_pendingWriteCount("/some/path")).toBe(0);
  });
});

// ── exec error handling edge cases ──────────────────────────

describe("exec error handling", () => {
  it("handles killed process (timeout)", async () => {
    const error = new Error("killed") as NodeJS.ErrnoException & { killed: boolean };
    error.killed = true;
    error.code = "SIGKILL";
    responseQueue.push({ error, stderr: "original stderr" });

    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
  });

  it("handles error with no stderr", async () => {
    responseQueue.push({
      error: { name: "Error", message: "fail", code: 1 as unknown as string } as unknown as NodeJS.ErrnoException,
      stderr: "",
    });

    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(false);
  });
});
