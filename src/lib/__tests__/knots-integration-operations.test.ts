/**
 * Integration tests for knots.ts CLI wrapper functions: operations and edges.
 * Covers listWorkflows, claimKnot, pollKnot, updateKnot,
 * listEdges, addEdge, removeEdge, and exec error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileCallbacks: Array<{
  args: string[];
  callback: ExecCallback;
}> = [];

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _options: unknown,
      callback: ExecCallback,
    ) => {
      execFileCallbacks.push({ args, callback });
    },
  ),
}));

import {
  listWorkflows,
  claimKnot,
  pollKnot,
  updateKnot,
  listEdges,
  addEdge,
  removeEdge,
} from "../knots";

function flush(): void {
  for (const entry of execFileCallbacks) {
    entry.callback(null, "{}", "");
  }
  execFileCallbacks.length = 0;
}

beforeEach(() => {
  execFileCallbacks.length = 0;
});

afterEach(() => {
  flush();
});

function resolveNext(
  stdout: string,
  stderr = "",
  error: Error | null = null,
): void {
  const entry = execFileCallbacks.shift();
  if (!entry) throw new Error("No pending execFile callback");
  entry.callback(error, stdout, stderr);
}

function rejectNext(stderr: string, code = 1): void {
  const entry = execFileCallbacks.shift();
  if (!entry) throw new Error("No pending execFile callback");
  const err = new Error(stderr) as NodeJS.ErrnoException;
  err.code = code as unknown as string;
  entry.callback(err, "", stderr);
}

describe("listWorkflows", () => {
  it("returns parsed workflows on success", async () => {
    const workflows = [
      { id: "wf-1", initial_state: "open", states: [], terminal_states: [] },
    ];
    const promise = listWorkflows("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext(JSON.stringify(workflows));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(workflows);
  });

  it("falls back to workflow ls --json", async () => {
    const workflows = [{ id: "wf-fallback" }];
    const promise = listWorkflows("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("unknown subcommand");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["workflow", "ls", "--json"]),
    );
    resolveNext(JSON.stringify(workflows));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(workflows);
  });

  it("returns error when both commands fail", async () => {
    const promise = listWorkflows("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail2");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON from primary", async () => {
    const promise = listWorkflows("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("returns error on invalid JSON from fallback", async () => {
    const promise = listWorkflows("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

describe("claimKnot", () => {
  it("returns parsed claim prompt on success", async () => {
    const prompt = {
      id: "K-1", title: "Claimed", state: "impl",
      profile_id: "auto", prompt: "# Claimed",
    };
    const promise = claimKnot("K-1", "/repo", { leaseId: "L-1" });
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["claim", "K-1", "--json"]));
    expect(args).toEqual(expect.arrayContaining(["--lease", "L-1"]));
    expect(args).not.toContain("--agent-name");
    expect(args).not.toContain("--agent-model");
    expect(args).not.toContain("--agent-version");
    resolveNext(JSON.stringify(prompt));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(prompt);
  });

  it("returns error on CLI failure", async () => {
    const promise = claimKnot("K-bad", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("not found");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    const promise = claimKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("passes --lease flag when leaseId provided", async () => {
    const prompt = {
      id: "K-1", title: "T", state: "impl",
      profile_id: "auto", prompt: "# P", lease_id: "L-1",
    };
    const promise = claimKnot("K-1", "/repo", { leaseId: "L-1" });
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["--lease", "L-1"]));
    resolveNext(JSON.stringify(prompt));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data?.lease_id).toBe("L-1");
  });

  it("omits --lease flag when leaseId not provided", async () => {
    const prompt = {
      id: "K-1", title: "T", state: "impl",
      profile_id: "auto", prompt: "# P",
    };
    const promise = claimKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).not.toEqual(expect.arrayContaining(["--lease"]));
    resolveNext(JSON.stringify(prompt));
    await promise;
  });
});

describe("pollKnot", () => {
  it("returns parsed poll prompt on success", async () => {
    const prompt = {
      id: "K-1", title: "Polled", state: "ready",
      profile_id: "auto", prompt: "# Poll",
    };
    const promise = pollKnot("/repo", {
      stage: "implementation",
      leaseId: "L-2",
    });
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["poll", "--claim", "--json"]));
    expect(args).toEqual(expect.arrayContaining(["implementation"]));
    expect(args).toEqual(expect.arrayContaining(["--lease", "L-2"]));
    expect(args).not.toContain("--agent-name");
    expect(args).not.toContain("--agent-model");
    expect(args).not.toContain("--agent-version");
    resolveNext(JSON.stringify(prompt));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(prompt);
  });

  it("returns error on CLI failure", async () => {
    const promise = pollKnot("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("no work");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    const promise = pollKnot("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

describe("updateKnot", () => {
  it("builds args for all update fields and omits agent identity flags", async () => {
    const promise = updateKnot("K-1", {
      title: "New Title", description: "New Desc",
      priority: 2, status: "implementing", type: "task",
      addTags: ["bug", "urgent"], removeTags: ["stale"],
      addNote: "Work started", noteUsername: "user1",
      noteDatetime: "2025-01-01T00:00:00Z",
      addHandoffCapsule: "Handoff data", handoffUsername: "user2",
      handoffDatetime: "2025-01-02T00:00:00Z",
      force: true,
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["update", "K-1"]));
    expect(args).toEqual(expect.arrayContaining(["--title=New Title"]));
    expect(args).toEqual(expect.arrayContaining(["--description=New Desc"]));
    expect(args).toEqual(expect.arrayContaining(["--priority", "2"]));
    expect(args).toEqual(expect.arrayContaining(["--force"]));
    expect(args).not.toContain("--note-agentname");
    expect(args).not.toContain("--note-model");
    expect(args).not.toContain("--note-version");
    expect(args).not.toContain("--handoff-agentname");
    expect(args).not.toContain("--handoff-model");
    expect(args).not.toContain("--handoff-version");
    resolveNext("");
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("addNote omits agent identity flags", async () => {
    const promise = updateKnot("K-1", {
      addNote: "just a note",
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["--add-note=just a note"]));
    expect(args).not.toContain("--note-agentname");
    expect(args).not.toContain("--note-model");
    expect(args).not.toContain("--note-version");
    resolveNext("");
    await promise;
  });

  it("addHandoffCapsule omits agent identity flags", async () => {
    const promise = updateKnot("K-1", {
      addHandoffCapsule: "capsule",
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(
      expect.arrayContaining(["--add-handoff-capsule=capsule"]),
    );
    expect(args).not.toContain("--handoff-agentname");
    expect(args).not.toContain("--handoff-model");
    expect(args).not.toContain("--handoff-version");
    resolveNext("");
    await promise;
  });

  it("skips empty tags", async () => {
    const promise = updateKnot("K-1", {
      addTags: ["valid", "  ", ""],
      removeTags: ["", "  "],
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    const addTagArgs = args.filter((v: string) => v.startsWith("--add-tag="));
    expect(addTagArgs).toHaveLength(1);
    expect(addTagArgs[0]).toBe("--add-tag=valid");
    const removeTagArgs = args.filter((v: string) => v.startsWith("--remove-tag="));
    expect(removeTagArgs).toHaveLength(0);
    resolveNext("");
    await promise;
  });

  it("returns error on CLI failure", async () => {
    const promise = updateKnot("K-1", { title: "fail" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("db locked");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("builds minimal args when only title is set", async () => {
    const promise = updateKnot("K-1", { title: "Just Title" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(
      expect.arrayContaining(["update", "K-1", "--title=Just Title"]),
    );
    expect(args).not.toEqual(expect.arrayContaining(["--force"]));
    resolveNext("");
    await promise;
  });
});

describe("listEdges", () => {
  it("returns parsed edges on success", async () => {
    const edges = [{ src: "K-1", kind: "blocked_by", dst: "K-2" }];
    const promise = listEdges("K-1", "both", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining([
        "edge", "list", "K-1", "--direction", "both", "--json",
      ]),
    );
    resolveNext(JSON.stringify(edges));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(edges);
  });

  it("passes direction parameter correctly", async () => {
    const promise = listEdges("K-1", "incoming", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--direction", "incoming"]),
    );
    resolveNext("[]");
    await promise;
  });

  it("returns error on CLI failure", async () => {
    const promise = listEdges("K-1", "outgoing", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("not found");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns error on invalid JSON", async () => {
    const promise = listEdges("K-1", "both", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

describe("addEdge", () => {
  it("returns ok on success", async () => {
    const promise = addEdge("K-1", "blocked_by", "K-2", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["edge", "add", "K-1", "blocked_by", "K-2"]),
    );
    resolveNext("");
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("returns error on CLI failure", async () => {
    const promise = addEdge("K-1", "blocked_by", "K-2", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("edge already exists");
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});

describe("removeEdge", () => {
  it("returns ok on success", async () => {
    const promise = removeEdge("K-1", "blocked_by", "K-2", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["edge", "remove", "K-1", "blocked_by", "K-2"]),
    );
    resolveNext("");
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("returns error on CLI failure", async () => {
    const promise = removeEdge("K-1", "blocked_by", "K-2", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("edge not found");
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});

describe("exec error handling", () => {
  it("includes timeout message when process is killed", async () => {
    const { listKnots } = await import("../knots");
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const entry = execFileCallbacks.shift()!;
    const err = new Error("timed out") as NodeJS.ErrnoException & {
      killed?: boolean;
    };
    err.killed = true;
    entry.callback(err, "", "");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("also failed");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("handles stderr alongside killed process", async () => {
    const { showKnot } = await import("../knots");
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const entry = execFileCallbacks.shift()!;
    const err = new Error("timed out") as NodeJS.ErrnoException & {
      killed?: boolean;
    };
    err.killed = true;
    entry.callback(err, "", "some stderr text");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("uses numeric error code when available", async () => {
    const { showKnot } = await import("../knots");
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const entry = execFileCallbacks.shift()!;
    const err = new Error("exit 2") as NodeJS.ErrnoException;
    err.code = 2 as unknown as string;
    entry.callback(err, "", "exit code 2");
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});
