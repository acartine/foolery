/**
 * Tests that canonical agent identity flows through the
 * Knots CLI wrapper. Verifies:
 *
 *   1) `toCanonicalLeaseIdentity` derives `agent_name` from
 *      command/provider, never from the display-only `label`.
 *   2) `createLease` emits canonical agent metadata as CLI
 *      flags (no display label leaking into `--agent-name`).
 *   3) `claimKnot` / `pollKnot` do NOT pass any
 *      `--agent-name|--agent-model|--agent-version` flags
 *      (those were removed by `d23064d2`).
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import {
  toCanonicalLeaseIdentity,
  toExecutionAgentInfo,
} from "../agent-identity";

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const execFileCallbacks: Array<{
  args: string[];
  callback: ExecCallback;
}> = [];

vi.mock("node:child_process", () => ({
  execFile: vi.fn((
    _bin: string,
    args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => {
    execFileCallbacks.push({ args, callback });
  }),
}));

import { claimKnot, pollKnot, createLease } from "../knots";

function resolveNext(stdout: string): void {
  const entry = execFileCallbacks.shift();
  if (!entry) {
    throw new Error("No pending execFile callback");
  }
  entry.callback(null, stdout, "");
}

beforeEach(() => { execFileCallbacks.length = 0; });
afterEach(() => {
  for (const e of execFileCallbacks) {
    e.callback(null, "{}", "");
  }
  execFileCallbacks.length = 0;
});

const agents = {
  claude: {
    command: "claude",
    model: "claude-opus-4.6",
    version: "4.6",
    kind: "cli" as const,
  },
  codex: {
    command: "codex",
    model: "gpt-5.4-codex",
    version: "5.4",
    label: "GPT Codex 5.4",
    kind: "cli" as const,
  },
  openCode: {
    command: "opencode",
    provider: "OpenCode",
    model: "copilot/anthropic/claude-sonnet-4",
    version: "4",
    kind: "cli" as const,
  },
};

describe("toCanonicalLeaseIdentity: label is display-only", () => {
  it("Claude config without agent_name derives from command", () => {
    const canonical = toCanonicalLeaseIdentity(agents.claude);
    expect(canonical.agent_name).toBe("Claude");
    expect(canonical.provider).toBe("Claude");
  });

  it("Codex config with label does not use label as agent_name", () => {
    const canonical = toCanonicalLeaseIdentity(agents.codex);
    expect(canonical.agent_name).toBe("Codex");
    expect(canonical.agent_name).not.toBe("GPT Codex 5.4");
  });

  it("explicit agent_name wins over command-based default", () => {
    const canonical = toCanonicalLeaseIdentity({
      command: "codex",
      agent_name: "my-agent",
      label: "Display",
      model: "gpt-5.4-codex",
      version: "5.4",
    });
    expect(canonical.agent_name).toBe("my-agent");
  });
});

describe("createLease: canonical fields go to CLI", () => {
  it("passes Claude canonical metadata as CLI flags", async () => {
    const info = toExecutionAgentInfo(agents.claude);
    const promise = createLease({
      nickname: "foolery:test",
      type: "agent",
      agentName: info.agentName,
      model: info.agentModel,
      modelVersion: info.agentVersion,
      provider: info.agentProvider,
      agentType: info.agentType,
    }, "/repo");
    await vi.waitFor(
      () => expect(execFileCallbacks).toHaveLength(1),
    );
    const args = execFileCallbacks[0].args;
    expect(args).toContain("--agent-name");
    expect(args).toContain("Claude");
    expect(args).toContain("--model");
    expect(args).toContain("opus/claude");
    expect(args).toContain("--model-version");
    expect(args).toContain("4.6");
    expect(args).toContain("--provider");
    expect(args).toContain("--agent-type");
    resolveNext(JSON.stringify({ id: "lease-1" }));
    await promise;
  });

  it("uses canonical name (Codex), not display label", async () => {
    const info = toExecutionAgentInfo(agents.codex);
    expect(info.agentName).toBe("Codex");
    const promise = createLease({
      nickname: "foolery:codex",
      type: "agent",
      agentName: info.agentName,
      model: info.agentModel,
      modelVersion: info.agentVersion,
      provider: info.agentProvider,
      agentType: info.agentType,
    }, "/repo");
    await vi.waitFor(
      () => expect(execFileCallbacks).toHaveLength(1),
    );
    const args = execFileCallbacks[0].args;
    // canonical name, NOT "GPT Codex 5.4"
    expect(args).toContain("Codex");
    expect(args).not.toContain("GPT Codex 5.4");
    resolveNext(JSON.stringify({ id: "lease-2" }));
    await promise;
  });

  it("passes OpenCode canonical metadata as CLI flags", async () => {
    const info = toExecutionAgentInfo(agents.openCode);
    const promise = createLease({
      nickname: "foolery:opencode",
      type: "agent",
      agentName: info.agentName,
      model: info.agentModel,
      modelVersion: info.agentVersion,
      provider: info.agentProvider,
      agentType: info.agentType,
    }, "/repo");
    await vi.waitFor(
      () => expect(execFileCallbacks).toHaveLength(1),
    );
    const args = execFileCallbacks[0].args;
    expect(args).toContain("OpenCode");
    expect(args).toContain(
      "copilot/anthropic/claude-sonnet-4",
    );
    expect(args).toContain("4");
    resolveNext(JSON.stringify({ id: "lease-3" }));
    await promise;
  });
});

describe("claim/poll: no agent metadata flags emitted", () => {
  const stub = JSON.stringify({
    id: "K-1", title: "T", state: "impl",
    profile_id: "auto", prompt: "# P",
  });

  it("claim args contain no agent metadata flags", async () => {
    const promise = claimKnot("K-1", "/repo", { leaseId: "L-1" });
    await vi.waitFor(
      () => expect(execFileCallbacks).toHaveLength(1),
    );
    const args = execFileCallbacks[0].args;
    expect(args).not.toContain("--agent-name");
    expect(args).not.toContain("--agent-model");
    expect(args).not.toContain("--agent-version");
    resolveNext(stub);
    await promise;
  });

  it("poll args contain no agent metadata flags", async () => {
    const promise = pollKnot("/repo", { leaseId: "L-2" });
    await vi.waitFor(
      () => expect(execFileCallbacks).toHaveLength(1),
    );
    const args = execFileCallbacks[0].args;
    expect(args).not.toContain("--agent-name");
    expect(args).not.toContain("--agent-model");
    expect(args).not.toContain("--agent-version");
    resolveNext(stub);
    await promise;
  });
});
