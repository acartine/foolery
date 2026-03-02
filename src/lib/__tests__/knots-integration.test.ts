/**
 * Integration tests for knots.ts CLI wrapper functions.
 *
 * Mocks node:child_process.execFile to control CLI responses and exercises
 * all public functions: listKnots, listProfiles, listWorkflows, showKnot,
 * newKnot, claimKnot, pollKnot, updateKnot, listEdges, addEdge, removeEdge.
 *
 * Covers success, error, fallback, and JSON parse failure paths to bring
 * statement coverage from ~40% to 70%+.
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
  listKnots,
  showKnot,
  newKnot,
  listProfiles,
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

// Helper to resolve the next pending callback
function resolveNext(stdout: string, stderr = "", error: Error | null = null): void {
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

// ---------------------------------------------------------------------------
// listKnots
// ---------------------------------------------------------------------------
describe("listKnots", () => {
  it("returns parsed knots on successful ls --all --json", async () => {
    const data = [{ id: "K-1", title: "test", state: "planning", updated_at: "2025-01-01" }];
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["ls", "--all", "--json"]),
    );
    resolveNext(JSON.stringify(data));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("falls back to ls --json when ls --all --json fails", async () => {
    const data = [{ id: "K-2", title: "fallback", state: "open", updated_at: "2025-01-01" }];
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("unknown flag --all");
    // Fallback call
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["ls", "--json"]),
    );
    resolveNext(JSON.stringify(data));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("returns error when both ls commands fail", async () => {
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail2");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error on invalid JSON from primary", async () => {
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("not-json{{{");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("returns error on invalid JSON from fallback", async () => {
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("flag error");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("bad-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

// ---------------------------------------------------------------------------
// showKnot
// ---------------------------------------------------------------------------
describe("showKnot", () => {
  it("returns parsed knot on success", async () => {
    const knot = { id: "K-1", title: "show me", state: "planning", updated_at: "2025-01-01" };
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["show", "K-1", "--json"]),
    );
    resolveNext(JSON.stringify(knot));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(knot);
  });

  it("returns error on CLI failure", async () => {
    const promise = showKnot("K-bad", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("not found");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error on invalid JSON", async () => {
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("{{invalid");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

// ---------------------------------------------------------------------------
// newKnot
// ---------------------------------------------------------------------------
describe("newKnot", () => {
  it("parses created ID from stdout", async () => {
    const promise = newKnot("My task", { description: "desc", state: "open" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["new", "--desc", "desc", "--state", "open"]));
    expect(args).toEqual(expect.arrayContaining(["--", "My task"]));
    resolveNext("created K-0042");
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: "K-0042" });
  });

  it("passes --profile when profile option is set", async () => {
    const promise = newKnot("Task", { profile: "semiauto" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--profile", "semiauto"]),
    );
    resolveNext("created K-0001");
    await promise;
  });

  it("passes --profile when workflow option is set (falls back)", async () => {
    const promise = newKnot("Task", { workflow: "granular" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--profile", "granular"]),
    );
    resolveNext("created K-0001");
    await promise;
  });

  it("uses body as description fallback", async () => {
    const promise = newKnot("Task", { body: "body-text" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--desc", "body-text"]),
    );
    resolveNext("created K-0001");
    await promise;
  });

  it("returns error on CLI failure", async () => {
    const promise = newKnot("Fail", {}, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("db locked");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns error when output does not contain created ID", async () => {
    const promise = newKnot("No ID", {}, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("some unexpected output");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });
});

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------
describe("listProfiles", () => {
  it("returns parsed profiles on success", async () => {
    const profiles = [{ id: "autopilot", initial_state: "planning", states: [], terminal_states: [] }];
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["profile", "list", "--json"]),
    );
    resolveNext(JSON.stringify(profiles));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(profiles);
  });

  it("falls back to profile ls --json", async () => {
    const profiles = [{ id: "fallback-profile" }];
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("unknown subcommand");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["profile", "ls", "--json"]),
    );
    resolveNext(JSON.stringify(profiles));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(profiles);
  });

  it("falls back to workflow list and converts to profiles", async () => {
    const workflows = [{
      id: "granular",
      description: "Automated",
      initial_state: "work_item",
      states: ["work_item", "shipped"],
      terminal_states: ["shipped"],
    }];
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("profile list failed");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("profile ls failed");
    // Now falls back to listWorkflows which calls workflow list --json
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["workflow", "list", "--json"]),
    );
    resolveNext(JSON.stringify(workflows));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("granular");
    // Should have generated owners
    expect(result.data![0].owners).toBeDefined();
    expect(result.data![0].owners.planning.kind).toBe("agent");
  });

  it("returns error on invalid JSON from primary", async () => {
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("not-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("returns error on invalid JSON from fallback ls", async () => {
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext("not-json");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("returns error when all fallbacks fail", async () => {
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail2");
    // workflow list --json
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail3");
    // workflow ls --json
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail4");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("converts human-gated workflow to profile with human review owners", async () => {
    const workflows = [{
      id: "coarse",
      description: "Human gated coarse workflow",
      initial_state: "work_item",
      states: ["work_item", "shipped"],
      terminal_states: ["shipped"],
    }];
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail1");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail2");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    resolveNext(JSON.stringify(workflows));
    const result = await promise;
    expect(result.ok).toBe(true);
    // "human" and "gated" in description triggers humanReview
    expect(result.data![0].owners.plan_review.kind).toBe("human");
    expect(result.data![0].owners.implementation_review.kind).toBe("human");
    expect(result.data![0].owners.planning.kind).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// listWorkflows
// ---------------------------------------------------------------------------
describe("listWorkflows", () => {
  it("returns parsed workflows on success", async () => {
    const workflows = [{ id: "wf-1", initial_state: "open", states: [], terminal_states: [] }];
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

// ---------------------------------------------------------------------------
// claimKnot
// ---------------------------------------------------------------------------
describe("claimKnot", () => {
  it("returns parsed claim prompt on success", async () => {
    const prompt = { id: "K-1", title: "Claimed", state: "impl", profile_id: "auto", prompt: "# Claimed" };
    const promise = claimKnot("K-1", "/repo", {
      agentName: "test-agent",
      agentModel: "test-model",
      agentVersion: "v1",
    });
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["claim", "K-1", "--json"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-name", "test-agent"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-model", "test-model"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-version", "v1"]));
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
});

// ---------------------------------------------------------------------------
// pollKnot
// ---------------------------------------------------------------------------
describe("pollKnot", () => {
  it("returns parsed poll prompt on success", async () => {
    const prompt = { id: "K-1", title: "Polled", state: "ready", profile_id: "auto", prompt: "# Poll" };
    const promise = pollKnot("/repo", {
      stage: "implementation",
      agentName: "agent1",
      agentModel: "model1",
      agentVersion: "v2",
    });
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["poll", "--claim", "--json"]));
    expect(args).toEqual(expect.arrayContaining(["implementation"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-name", "agent1"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-model", "model1"]));
    expect(args).toEqual(expect.arrayContaining(["--agent-version", "v2"]));
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

// ---------------------------------------------------------------------------
// updateKnot
// ---------------------------------------------------------------------------
describe("updateKnot", () => {
  it("builds args for all update fields", async () => {
    const promise = updateKnot("K-1", {
      title: "New Title",
      description: "New Desc",
      priority: 2,
      status: "implementing",
      type: "task",
      addTags: ["bug", "urgent"],
      removeTags: ["stale"],
      addNote: "Work started",
      noteUsername: "user1",
      noteDatetime: "2025-01-01T00:00:00Z",
      noteAgentname: "agent1",
      noteModel: "model1",
      noteVersion: "v1",
      addHandoffCapsule: "Handoff data",
      handoffUsername: "user2",
      handoffDatetime: "2025-01-02T00:00:00Z",
      handoffAgentname: "agent2",
      handoffModel: "model2",
      handoffVersion: "v2",
      force: true,
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["update", "K-1"]));
    expect(args).toEqual(expect.arrayContaining(["--title", "New Title"]));
    expect(args).toEqual(expect.arrayContaining(["--description", "New Desc"]));
    expect(args).toEqual(expect.arrayContaining(["--priority", "2"]));
    expect(args).toEqual(expect.arrayContaining(["--status", "implementing"]));
    expect(args).toEqual(expect.arrayContaining(["--type", "task"]));
    expect(args).toEqual(expect.arrayContaining(["--add-tag", "bug"]));
    expect(args).toEqual(expect.arrayContaining(["--add-tag", "urgent"]));
    expect(args).toEqual(expect.arrayContaining(["--remove-tag", "stale"]));
    expect(args).toEqual(expect.arrayContaining(["--add-note", "Work started"]));
    expect(args).toEqual(expect.arrayContaining(["--note-username", "user1"]));
    expect(args).toEqual(expect.arrayContaining(["--note-datetime", "2025-01-01T00:00:00Z"]));
    expect(args).toEqual(expect.arrayContaining(["--note-agentname", "agent1"]));
    expect(args).toEqual(expect.arrayContaining(["--note-model", "model1"]));
    expect(args).toEqual(expect.arrayContaining(["--note-version", "v1"]));
    expect(args).toEqual(expect.arrayContaining(["--add-handoff-capsule", "Handoff data"]));
    expect(args).toEqual(expect.arrayContaining(["--handoff-username", "user2"]));
    expect(args).toEqual(expect.arrayContaining(["--handoff-datetime", "2025-01-02T00:00:00Z"]));
    expect(args).toEqual(expect.arrayContaining(["--handoff-agentname", "agent2"]));
    expect(args).toEqual(expect.arrayContaining(["--handoff-model", "model2"]));
    expect(args).toEqual(expect.arrayContaining(["--handoff-version", "v2"]));
    expect(args).toEqual(expect.arrayContaining(["--force"]));
    resolveNext("");
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("skips empty tags", async () => {
    const promise = updateKnot("K-1", {
      addTags: ["valid", "  ", ""],
      removeTags: ["", "  "],
    }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    // Only "valid" should appear as --add-tag
    const addTagIndices = args.reduce<number[]>((acc, v, i) => {
      if (v === "--add-tag") acc.push(i);
      return acc;
    }, []);
    expect(addTagIndices).toHaveLength(1);
    expect(args[addTagIndices[0] + 1]).toBe("valid");
    // No --remove-tag since all are empty/whitespace
    expect(args).not.toEqual(expect.arrayContaining(["--remove-tag"]));
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
    expect(args).toEqual(expect.arrayContaining(["update", "K-1", "--title", "Just Title"]));
    expect(args).not.toEqual(expect.arrayContaining(["--force"]));
    expect(args).not.toEqual(expect.arrayContaining(["--add-note"]));
    expect(args).not.toEqual(expect.arrayContaining(["--add-handoff-capsule"]));
    resolveNext("");
    await promise;
  });
});

// ---------------------------------------------------------------------------
// listEdges
// ---------------------------------------------------------------------------
describe("listEdges", () => {
  it("returns parsed edges on success", async () => {
    const edges = [{ src: "K-1", kind: "blocked_by", dst: "K-2" }];
    const promise = listEdges("K-1", "both", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["edge", "list", "K-1", "--direction", "both", "--json"]),
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

// ---------------------------------------------------------------------------
// addEdge
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// removeEdge
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// exec: timeout and error code handling
// ---------------------------------------------------------------------------
describe("exec error handling", () => {
  it("includes timeout message when process is killed", async () => {
    const promise = listKnots("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const entry = execFileCallbacks.shift()!;
    const err = new Error("timed out") as NodeJS.ErrnoException & { killed?: boolean };
    err.killed = true;
    entry.callback(err, "", "");
    // Fallback will be called
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("also failed");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("handles stderr alongside killed process", async () => {
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const entry = execFileCallbacks.shift()!;
    const err = new Error("timed out") as NodeJS.ErrnoException & { killed?: boolean };
    err.killed = true;
    entry.callback(err, "", "some stderr text");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("uses numeric error code when available", async () => {
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
