import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockLoadSettings = vi.fn();

vi.mock("@/lib/settings", () => ({
  loadSettings: () => mockLoadSettings(),
}));

import {
  listStaleBeatGroomingAgentOptions,
  resolveStaleBeatGroomingAgent,
} from "@/lib/stale-beat-grooming-agent";
import type { FoolerySettings } from "@/lib/schemas";

function settings(
  partial: Partial<FoolerySettings>,
): FoolerySettings {
  return {
    agents: {
      codex: {
        command: "codex",
        label: "Codex",
        model: "gpt-5.4",
      },
      hermes: {
        command: "hermes",
        label: "Hermes",
        model: "leftover-quota",
      },
    },
    actions: {
      take: "",
      scene: "",
      scopeRefinement: "",
      staleGrooming: "codex",
    },
    pools: {
      orchestration: [],
      planning: [],
      plan_review: [],
      implementation: [],
      implementation_review: [],
      shipment: [],
      shipment_review: [],
      scope_refinement: [],
      stale_grooming: [],
    },
    dispatchMode: "basic",
    backend: { type: "auto" },
    defaults: {
      profileId: "",
      interactiveSessionTimeoutMinutes: 10,
    },
    scopeRefinement: { prompt: "" },
    maxConcurrentSessions: 5,
    maxClaimsPerQueueType: 10,
    terminalLightTheme: false,
    ...partial,
  };
}

describe("stale beat grooming agent resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the basic dispatch default", async () => {
    mockLoadSettings.mockResolvedValue(settings({}));

    await expect(resolveStaleBeatGroomingAgent()).resolves.toMatchObject({
      command: "codex",
      agentId: "codex",
      model: "gpt-5.4",
    });
  });

  it("resolves the advanced stale grooming pool default", async () => {
    mockLoadSettings.mockResolvedValue(settings({
      dispatchMode: "advanced",
      pools: {
        ...settings({}).pools,
        stale_grooming: [{ agentId: "hermes", weight: 1 }],
      },
    }));

    await expect(resolveStaleBeatGroomingAgent()).resolves.toMatchObject({
      command: "hermes",
      agentId: "hermes",
      model: "leftover-quota",
    });
  });

  it("allows explicit override to any configured agent", async () => {
    mockLoadSettings.mockResolvedValue(settings({}));

    await expect(
      resolveStaleBeatGroomingAgent({ agentId: "hermes" }),
    ).resolves.toMatchObject({
      command: "hermes",
      agentId: "hermes",
    });
  });

  it("fails loudly when the default dispatch target is missing", async () => {
    mockLoadSettings.mockResolvedValue(settings({
      actions: {
        take: "",
        scene: "",
        scopeRefinement: "",
        staleGrooming: "",
      },
    }));

    await expect(resolveStaleBeatGroomingAgent()).rejects.toThrow(
      "FOOLERY GROOMING FAILURE",
    );
  });

  it("lists all configured options and the dispatch-selected default", async () => {
    mockLoadSettings.mockResolvedValue(settings({}));

    await expect(listStaleBeatGroomingAgentOptions()).resolves.toEqual({
      agents: [
        {
          id: "codex",
          label: "Codex",
          command: "codex",
          model: "gpt-5.4",
        },
        {
          id: "hermes",
          label: "Hermes",
          command: "hermes",
          model: "leftover-quota",
        },
      ],
      defaultAgentId: "codex",
    });
  });
});
