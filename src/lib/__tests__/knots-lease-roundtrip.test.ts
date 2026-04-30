/**
 * Per-provider lease round-trip test. For each provider in
 * `AgentProviderId` (minus `unknown`):
 *
 *   1. Build an `AgentIdentityLike` from a realistic
 *      settings.toml shape.
 *   2. Pipe through `toCanonicalLeaseIdentity` ->
 *      `toExecutionAgentInfo` -> `createLease`.
 *   3. Capture the argv that would be sent to `kno lease create`.
 *   4. Synthesize the `kno lease show --json` response a real
 *      Knots binary would emit for the same lease (per
 *      `~/knots/docs/leases.md` and the AgentInfo struct in
 *      `~/knots/src/domain/lease.rs`):
 *
 *        {
 *          id: "...",
 *          lease: {
 *            agent_info: {
 *              agent_type: "cli",
 *              provider: "...",
 *              agent_name: "...",
 *              model: "...",
 *              model_version: "...",
 *            },
 *            ...
 *          },
 *          ...
 *        }
 *
 *   5. Re-derive `ExecutionAgentInfo` from the response and
 *      assert it matches what we put in.
 *
 * This catches shape drift between Foolery's
 * `CanonicalLeaseIdentity` and Knots' `AgentInfo`. Hermetic per
 * `docs/DEVELOPING.md` -- mocks `node:child_process.execFile`
 * and never shells out to a real `kno`.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import {
  toCanonicalLeaseIdentity,
  toExecutionAgentInfo,
  type AgentIdentityLike,
} from "../agent-identity";
import type { ExecutionAgentInfo } from "../execution-port";

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

import { createLease } from "../knots";

function resolveNext(stdout: string): void {
  const entry = execFileCallbacks.shift();
  if (!entry) throw new Error("No pending execFile callback");
  entry.callback(null, stdout, "");
}

beforeEach(() => { execFileCallbacks.length = 0; });
afterEach(() => {
  for (const e of execFileCallbacks) e.callback(null, "{}", "");
  execFileCallbacks.length = 0;
});

/**
 * Pulls `--<flag> <value>` pairs out of the argv captured at the
 * mocked `execFile`. Matches how `lease create` formats flags.
 */
function pairFromArgs(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

interface KnotsAgentInfoFixture {
  agent_type: string;
  provider: string;
  agent_name: string;
  model: string;
  model_version: string;
}

interface KnotsLeaseShowFixture {
  id: string;
  lease: {
    lease_type: "agent";
    nickname: string;
    agent_info: KnotsAgentInfoFixture;
    timeout_seconds: number;
  };
}

/**
 * Mirrors what `kno lease show <id> --json` would produce on a
 * lease created with the captured argv. Field shape matches the
 * `AgentInfo` struct in `knots/src/domain/lease.rs`.
 */
function buildLeaseShowResponse(
  id: string,
  nickname: string,
  args: string[],
): KnotsLeaseShowFixture {
  return {
    id,
    lease: {
      lease_type: "agent",
      nickname,
      agent_info: {
        agent_type: pairFromArgs(args, "--agent-type") ?? "",
        provider: pairFromArgs(args, "--provider") ?? "",
        agent_name: pairFromArgs(args, "--agent-name") ?? "",
        model: pairFromArgs(args, "--model") ?? "",
        model_version: pairFromArgs(args, "--model-version") ?? "",
      },
      timeout_seconds: 600,
    },
  };
}

/**
 * Re-derives an `ExecutionAgentInfo` from a `kno lease show`
 * payload. Mirrors the canonical agent_info -> ExecutionAgentInfo
 * mapping enforced by `toExecutionAgentInfo` /
 * `toCanonicalLeaseIdentity`.
 */
function executionAgentInfoFromLeaseShow(
  payload: KnotsLeaseShowFixture,
): ExecutionAgentInfo {
  const a = payload.lease.agent_info;
  return {
    agentName: a.agent_name,
    agentProvider: a.provider,
    agentModel: a.model,
    agentVersion: a.model_version,
    agentType: a.agent_type,
  };
}

const agents: Record<string, AgentIdentityLike> = {
  Claude: {
    command: "claude",
    model: "claude-opus-4-7",
    version: "4.7",
    kind: "cli",
  },
  Codex: {
    command: "codex",
    model: "gpt-5",
    version: "5",
    kind: "cli",
  },
  Gemini: {
    command: "gemini",
    model: "gemini-2.5-pro",
    version: "2.5",
    kind: "cli",
  },
  Copilot: {
    command: "copilot",
    model: "claude-sonnet-4-5",
    version: "4.5",
    kind: "cli",
  },
  OpenCode: {
    command: "opencode",
    provider: "OpenCode",
    model: "openrouter/moonshotai/kimi-k2.6",
    kind: "cli",
  },
};

describe("createLease -> lease show round-trip per provider", () => {
  for (const [name, agent] of Object.entries(agents)) {
    it(`${name}: canonical fields survive create -> show`, async () => {
      const expected = toExecutionAgentInfo(agent);
      // Sanity: every provider must produce a populated
      // canonical identity. If any of these become undefined the
      // round-trip itself becomes meaningless.
      expect(expected.agentName).toBeTruthy();
      expect(expected.agentProvider).toBeTruthy();
      expect(expected.agentModel).toBeTruthy();
      expect(expected.agentVersion).toBeTruthy();
      expect(expected.agentType).toBe("cli");

      const nickname = `foolery:roundtrip:${name.toLowerCase()}`;
      const leaseId = `lease-${name.toLowerCase()}`;
      const promise = createLease({
        nickname,
        type: "agent",
        agentName: expected.agentName,
        model: expected.agentModel,
        modelVersion: expected.agentVersion,
        provider: expected.agentProvider,
        agentType: expected.agentType,
      }, "/repo");
      await vi.waitFor(
        () => expect(execFileCallbacks).toHaveLength(1),
      );
      const args = execFileCallbacks[0].args;

      // The mocked `kno lease create --json` returns the same
      // payload `kno lease show <id> --json` would emit for the
      // newly created lease.
      const showResponse = buildLeaseShowResponse(
        leaseId, nickname, args,
      );
      resolveNext(JSON.stringify(showResponse));
      const result = await promise;
      expect(result.ok).toBe(true);

      // Round-trip: re-derive ExecutionAgentInfo from the
      // payload and compare against what we sent in.
      const roundTripped = executionAgentInfoFromLeaseShow(showResponse);
      expect(roundTripped).toEqual(expected);
    });
  }

  it("toCanonicalLeaseIdentity output matches lease.agent_info shape", () => {
    // Cross-check: the struct returned by Foolery's canonical
    // identity has the same field set Knots writes back, modulo
    // Foolery's `lease_model` <-> Knots' `model` rename and the
    // `version` <-> `model_version` rename.
    const canonical = toCanonicalLeaseIdentity(agents.Claude!);
    const knotsKeys: Array<keyof KnotsAgentInfoFixture> = [
      "agent_type", "provider", "agent_name", "model", "model_version",
    ];
    for (const k of knotsKeys) {
      const fooleryKey =
        k === "model" ? "lease_model"
        : k === "model_version" ? "version"
        : k;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((canonical as any)[fooleryKey]).toBeTruthy();
    }
  });
});
