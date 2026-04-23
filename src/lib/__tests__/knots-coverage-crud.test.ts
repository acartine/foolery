/**
 * Coverage tests for src/lib/knots.ts: CRUD operations.
 * Covers listKnots, showKnot, newKnot, claimKnot, pollKnot,
 * updateKnot, and setKnotProfile.
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
  listKnots,
  showKnot,
  rehydrateKnot,
  newKnot,
  claimKnot,
  pollKnot,
  updateKnot,
  setKnotProfile,
} from "@/lib/knots";
import type {
  KnotRecord,
  KnotClaimPrompt,
} from "@/lib/knots";

beforeEach(() => {
  vi.clearAllMocks();
  responseQueue = [];
  execFileCallArgs.length = 0;
});

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
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: JSON.stringify(records) });
    const result = await listKnots("/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(records);
  });

  it("returns error when both ls variants fail", async () => {
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
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
    });
    responseQueue.push({ stdout: "bad json" });
    const result = await listKnots("/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

describe("showKnot", () => {
  it("parses successful output", async () => {
    const record: KnotRecord = {
      id: "42", title: "Detail", state: "open",
      updated_at: "2026-01-01T00:00:00Z",
    };
    responseQueue.push({ stdout: JSON.stringify(record) });
    const result = await showKnot("42", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("42");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
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

describe("rehydrateKnot", () => {
  it("parses successful output", async () => {
    const record: KnotRecord = {
      id: "42",
      title: "Rehydrated",
      state: "shipped",
      updated_at: "2026-01-01T00:00:00Z",
    };
    responseQueue.push({ stdout: JSON.stringify(record) });
    const result = await rehydrateKnot("42", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("42");
    expect(execFileCallArgs[0]).toContain("rehydrate");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "rehydrate failed",
    });
    const result = await rehydrateKnot("42", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rehydrate failed");
  });

  it("returns error on invalid JSON", async () => {
    responseQueue.push({ stdout: "bad" });
    const result = await rehydrateKnot("42", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});

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
    expect(callArgs).toContain("--desc=My desc");
  });

  it("passes body as description", async () => {
    responseQueue.push({ stdout: "created 101" });
    await newKnot("Title", { body: "Body text" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--desc=Body text");
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

  it("passes workflow option", async () => {
    responseQueue.push({ stdout: "created 104" });
    await newKnot("Title", { workflow: "autopilot" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--workflow");
    expect(callArgs).toContain("autopilot");
  });

  it("passes native knot type and tags", async () => {
    responseQueue.push({ stdout: "created 105" });
    await newKnot(
      "Title",
      {
        type: "execution_plan",
        tags: ["spec:foolery/spec.md", "slice:all", ""],
      },
      "/repo",
    );
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--type");
    expect(callArgs).toContain("execution_plan");
    expect(callArgs).toContain("--tag=spec:foolery/spec.md");
    expect(callArgs).toContain("--tag=slice:all");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
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

describe("claimKnot", () => {
  it("parses successful claim output", async () => {
    const claimPrompt: KnotClaimPrompt = {
      id: "42", title: "Claim Test", state: "open",
      profile_id: "autopilot", prompt: "Do the thing",
    };
    responseQueue.push({ stdout: JSON.stringify(claimPrompt) });
    const result = await claimKnot("42", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("42");
  });

  it("passes leaseId and omits deprecated agent flags", async () => {
    responseQueue.push({
      stdout: JSON.stringify({
        id: "42", title: "T", state: "open",
        profile_id: "a", prompt: "p",
      }),
    });
    await claimKnot("42", "/repo", { leaseId: "lease-xyz" });
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--lease");
    expect(callArgs).toContain("lease-xyz");
    expect(callArgs).not.toContain("--agent-name");
    expect(callArgs).not.toContain("--agent-model");
    expect(callArgs).not.toContain("--agent-version");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
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

describe("pollKnot", () => {
  it("parses successful poll output", async () => {
    const claimPrompt: KnotClaimPrompt = {
      id: "99", title: "Poll Test", state: "open",
      profile_id: "autopilot", prompt: "Do polling",
    };
    responseQueue.push({ stdout: JSON.stringify(claimPrompt) });
    const result = await pollKnot("/repo");
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("99");
  });

  it("passes stage and leaseId, omits deprecated agent flags", async () => {
    responseQueue.push({
      stdout: JSON.stringify({
        id: "99", title: "T", state: "open",
        profile_id: "a", prompt: "p",
      }),
    });
    await pollKnot("/repo", {
      stage: "implementation",
      leaseId: "lease-abc",
    });
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("implementation");
    expect(callArgs).toContain("--lease");
    expect(callArgs).toContain("lease-abc");
    expect(callArgs).not.toContain("--agent-name");
    expect(callArgs).not.toContain("--agent-model");
    expect(callArgs).not.toContain("--agent-version");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
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

describe("updateKnot", () => {
  it("succeeds with all options and omits deprecated agent flags", async () => {
    responseQueue.push({});
    const result = await updateKnot("42", {
      title: "New Title", description: "New desc",
      priority: 1, status: "closed", type: "bug",
      addTags: ["tag1", "tag2"], removeTags: ["old-tag"],
      addNote: "A note", noteUsername: "user1",
      noteDatetime: "2026-01-01",
      addHandoffCapsule: "Capsule text", handoffUsername: "user2",
      handoffDatetime: "2026-01-02",
      executionPlanFile: "/tmp/plan.json",
      force: true,
    }, "/repo");
    expect(result.ok).toBe(true);
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--title=New Title");
    expect(callArgs).toContain("--execution-plan-file");
    expect(callArgs).toContain("/tmp/plan.json");
    expect(callArgs).toContain("--force");
    expect(callArgs).not.toContain("--note-agentname");
    expect(callArgs).not.toContain("--note-model");
    expect(callArgs).not.toContain("--note-version");
    expect(callArgs).not.toContain("--handoff-agentname");
    expect(callArgs).not.toContain("--handoff-model");
    expect(callArgs).not.toContain("--handoff-version");
  });

  it("omits deprecated agent flags from note args", async () => {
    responseQueue.push({});
    await updateKnot("42", { addNote: "a note" }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--add-note=a note");
    expect(callArgs).toContain("--note-username");
    expect(callArgs).toContain("foolery");
    expect(callArgs).not.toContain("--note-agentname");
    expect(callArgs).not.toContain("--note-model");
    expect(callArgs).not.toContain("--note-version");
  });

  it("omits deprecated agent flags from handoff args", async () => {
    responseQueue.push({});
    await updateKnot("42", {
      addHandoffCapsule: "capsule",
    }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("--add-handoff-capsule=capsule");
    expect(callArgs).toContain("--handoff-username");
    expect(callArgs).not.toContain("--handoff-agentname");
    expect(callArgs).not.toContain("--handoff-model");
    expect(callArgs).not.toContain("--handoff-version");
  });

  it("skips empty tag strings", async () => {
    responseQueue.push({});
    await updateKnot("42", { addTags: ["", "  ", "valid"] }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    const addTagArgs = callArgs.filter(
      (arg: string) => arg.startsWith("--add-tag="),
    );
    expect(addTagArgs.length).toBe(1);
    expect(addTagArgs[0]).toBe("--add-tag=valid");
  });

  it("serializes invariant mutations", async () => {
    responseQueue.push({});
    await updateKnot("42", {
      addInvariants: ["  Scope:src/lib  ", "", "   "],
      removeInvariants: ["  State:must remain queued  ", " "],
      clearInvariants: true,
    }, "/repo");
    const callArgs = execFileCallArgs[0]!;
    const addInvArgs = callArgs.filter(
      (arg: string) => arg.startsWith("--add-invariant="),
    );
    const removeInvArgs = callArgs.filter(
      (arg: string) => arg.startsWith("--remove-invariant="),
    );
    expect(addInvArgs).toEqual(["--add-invariant=Scope:src/lib"]);
    expect(removeInvArgs).toEqual(
      ["--remove-invariant=State:must remain queued"],
    );
    expect(callArgs).toContain("--clear-invariants");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
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

describe("setKnotProfile", () => {
  it("passes profile id and optional state", async () => {
    responseQueue.push({});
    const result = await setKnotProfile(
      "42", "semiauto", "/repo",
      { state: "ready_for_implementation" },
    );
    expect(result.ok).toBe(true);
    const callArgs = execFileCallArgs[0]!;
    expect(callArgs).toContain("profile");
    expect(callArgs).toContain("set");
    expect(callArgs).toContain("42");
    expect(callArgs).toContain("semiauto");
    expect(callArgs).toContain("--state");
    expect(callArgs).toContain("ready_for_implementation");
  });

  it("returns error on non-zero exit", async () => {
    responseQueue.push({
      error: {
        name: "Error", message: "fail",
        code: 1 as unknown as string,
      } as unknown as NodeJS.ErrnoException,
      stderr: "profile set err",
    });
    const result = await setKnotProfile("42", "semiauto", "/repo");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("profile set err");
  });
});
