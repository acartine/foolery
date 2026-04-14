/**
 * Integration tests for knots.ts CLI wrapper functions: CRUD operations.
 * Covers listKnots, showKnot, newKnot, listProfiles.
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

describe("showKnot", () => {
  it("returns parsed knot on success", async () => {
    const knot = {
      id: "K-1",
      title: "show me",
      state: "planning",
      updated_at: "2025-01-01",
      execution_plan: {
        repo_path: "/repo",
        summary: "Summary",
        waves: [{
          wave_index: 1,
          name: "wave-1",
          objective: "Do work",
          steps: [{ step_index: 1, beat_ids: ["beat-1"] }],
        }],
      },
    };
    const promise = showKnot("K-1", "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["show", "K-1", "--json"]),
    );
    resolveNext(JSON.stringify(knot));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(knot);
    expect(result.data?.execution_plan?.waves?.[0]).toMatchObject({
      wave_index: 1,
    });
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

describe("newKnot", () => {
  it("parses created ID from stdout", async () => {
    const promise = newKnot("My task", { description: "desc", state: "open" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    const args = execFileCallbacks[0].args;
    expect(args).toEqual(expect.arrayContaining(["new", "--desc=desc", "--state", "open"]));
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

  it("passes --workflow when workflow option is set", async () => {
    const promise = newKnot("Task", { workflow: "granular" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--workflow", "granular"]),
    );
    resolveNext("created K-0001");
    await promise;
  });

  it("passes knot type and tags when provided", async () => {
    const promise = newKnot(
      "Plan",
      {
        type: "execution_plan",
        tags: ["spec:foo/bar.md", "slice:all", "   "],
      },
      "/repo",
    );
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining([
        "--type",
        "execution_plan",
        "--tag=spec:foo/bar.md",
        "--tag=slice:all",
      ]),
    );
    resolveNext("created K-0002");
    await promise;
  });

  it("uses body as description fallback", async () => {
    const promise = newKnot("Task", { body: "body-text" }, "/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["--desc=body-text"]),
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

describe("listProfiles: success and fallback paths", () => {
  it("returns parsed profiles on success", async () => {
    const profiles = [
      { id: "autopilot", initial_state: "planning", states: [], terminal_states: [] },
    ];
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
      id: "granular", description: "Automated",
      initial_state: "work_item", states: ["work_item", "shipped"],
      terminal_states: ["shipped"],
    }];
    const promise = listProfiles("/repo");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("profile list failed");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("profile ls failed");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    expect(execFileCallbacks[0].args).toEqual(
      expect.arrayContaining(["workflow", "list", "--json"]),
    );
    resolveNext(JSON.stringify(workflows));
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("granular");
    expect(result.data![0].owners).toBeDefined();
    expect(result.data![0].owners.states!.planning.kind).toBe(
      "agent",
    );
  });
});

describe("listProfiles: error and workflow conversion", () => {
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
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail3");
    await vi.waitFor(() => expect(execFileCallbacks).toHaveLength(1));
    rejectNext("fail4");
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("converts human-gated workflow to profile with human review owners", async () => {
    const workflows = [{
      id: "coarse", description: "Human gated coarse workflow",
      initial_state: "work_item", states: ["work_item", "shipped"],
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
    expect(
      result.data![0].owners.states!.plan_review.kind,
    ).toBe("human");
    expect(
      result.data![0].owners.states!.implementation_review.kind,
    ).toBe("human");
    expect(
      result.data![0].owners.states!.planning.kind,
    ).toBe("agent");
  });
});
