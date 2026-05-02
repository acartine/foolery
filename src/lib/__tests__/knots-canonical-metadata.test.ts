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

// Realistic settings.toml agent shapes — one per non-`unknown`
// provider in `AgentProviderId`. Drawn from typical foolery configs.
const agents = {
  claude: {
    command: "claude",
    model: "claude-opus-4-7",
    version: "4.7",
    kind: "cli" as const,
  },
  codex: {
    command: "codex",
    model: "gpt-5.4-codex",
    version: "5.4",
    label: "GPT Codex 5.4",
    kind: "cli" as const,
  },
  gemini: {
    command: "gemini",
    model: "gemini-2.5-pro",
    version: "2.5",
    kind: "cli" as const,
  },
  copilot: {
    command: "copilot",
    model: "claude-sonnet-4-5",
    version: "4.5",
    kind: "cli" as const,
  },
  openCode: {
    command: "opencode",
    provider: "OpenCode",
    model: "openrouter/moonshotai/kimi-k2.6",
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

// Helper that pipes a settings.toml-shaped agent through
// `toExecutionAgentInfo` and into `createLease`, captures the
// argv that would be sent to `kno`, and resolves the mocked
// `execFile` callback. Returns the captured argv for assertion.
async function captureCreateLeaseArgs(
  agent: Parameters<typeof toExecutionAgentInfo>[0],
  nickname: string,
  leaseId: string,
): Promise<string[]> {
  const info = toExecutionAgentInfo(agent);
  const promise = createLease({
    nickname,
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
  resolveNext(JSON.stringify({ id: leaseId }));
  await promise;
  return args;
}

/**
 * Asserts that the captured `kno lease create` argv contains
 * the standard envelope (`lease create --nickname <n> --type
 * agent --agent-type cli --json`) plus the per-provider
 * agent-name / provider / model / model-version values.
 */
function assertCanonicalLeaseArgs(
  args: string[],
  expected: {
    nickname: string;
    agentName: string;
    provider: string;
    model: string;
    version: string;
  },
): void {
  expect(args).toContain("lease");
  expect(args).toContain("create");
  expect(args).toContain("--nickname");
  expect(args).toContain(expected.nickname);
  expect(args).toContain("--type");
  expect(args).toContain("agent");
  expect(args).toContain("--agent-name");
  expect(args).toContain(expected.agentName);
  expect(args).toContain("--provider");
  expect(args).toContain(expected.provider);
  expect(args).toContain("--model");
  expect(args).toContain(expected.model);
  expect(args).toContain("--model-version");
  expect(args).toContain(expected.version);
  expect(args).toContain("--agent-type");
  expect(args).toContain("cli");
  expect(args).toContain("--json");
}

describe("createLease canonical fields", () => {
  it("Claude: passes canonical metadata as CLI flags", async () => {
    const args = await captureCreateLeaseArgs(
      agents.claude, "foolery:claude", "lease-claude",
    );
    // Display-form: model="Claude" dropped (equals provider),
    // flavor "Opus" kept. lease_model is just "Opus" — the
    // Provider column shows "Claude" already so no need to repeat.
    assertCanonicalLeaseArgs(args, {
      nickname: "foolery:claude",
      agentName: "Claude",
      provider: "Claude",
      model: "Opus",
      version: "4.7",
    });
    // No identity flags other than canonical ones.
    expect(args).not.toContain("--label");
    expect(args).not.toContain("--flavor");
  });

  it("Codex: uses canonical name (Codex), not display label", async () => {
    const info = toExecutionAgentInfo(agents.codex);
    expect(info.agentName).toBe("Codex");
    const args = await captureCreateLeaseArgs(
      agents.codex, "foolery:codex", "lease-codex",
    );
    // Codex with `gpt-5.4-codex` -> model="GPT" (kept), flavor
    // "Codex" (kept — flavor is always preserved, even when it
    // equals the provider; Codex variants accept the redundancy
    // because flavor is the load-bearing distinguisher).
    assertCanonicalLeaseArgs(args, {
      nickname: "foolery:codex",
      agentName: "Codex",
      provider: "Codex",
      model: "GPT Codex",
      version: "5.4",
    });
    // canonical name, NOT a label-format with version mixed in.
    expect(args).not.toContain("GPT Codex 5.4");
  });

  it("Gemini: passes canonical metadata as CLI flags", async () => {
    const args = await captureCreateLeaseArgs(
      agents.gemini, "foolery:gemini", "lease-gemini",
    );
    assertCanonicalLeaseArgs(args, {
      nickname: "foolery:gemini",
      agentName: "Gemini",
      provider: "Gemini",
      // model="Gemini" dropped (equals provider); flavor "Pro" kept.
      model: "Pro",
      version: "2.5",
    });
  });

  it("Copilot: passes canonical metadata as CLI flags", async () => {
    const args = await captureCreateLeaseArgs(
      agents.copilot, "foolery:copilot", "lease-copilot",
    );
    // Copilot is always the provider — even when routing Anthropic
    // weights. The inner family (Claude Sonnet) lives in
    // model + flavor so the full provenance shows in the label
    // ("Copilot Claude Sonnet 4.5") rather than collapsing to
    // "Claude Sonnet 4.5" and hiding the runtime engine.
    assertCanonicalLeaseArgs(args, {
      nickname: "foolery:copilot",
      agentName: "Copilot",
      provider: "Copilot",
      // model="Claude" + flavor="Sonnet" — neither equals provider
      // "Copilot", both kept. lease_model = "Claude Sonnet".
      model: "Claude Sonnet",
      version: "4.5",
    });
  });

  it("OpenCode: passes canonical metadata as CLI flags", async () => {
    const args = await captureCreateLeaseArgs(
      agents.openCode, "foolery:opencode", "lease-opencode",
    );
    // OpenCode emits a single canonical form: pre-formatted display
    // string with version split off. Flavor is undefined.
    assertCanonicalLeaseArgs(args, {
      nickname: "foolery:opencode",
      agentName: "OpenCode",
      provider: "OpenCode",
      model: "OpenRouter MoonshotAI Kimi-k",
      version: "2.6",
    });
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
