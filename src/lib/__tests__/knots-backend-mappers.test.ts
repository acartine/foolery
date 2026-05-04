import { describe, expect, it } from "vitest";
import { toBeat } from "@/lib/backends/knots-backend-mappers";
import type { KnotRecord } from "@/lib/knots";
import { defaultWorkflowDescriptor } from "@/lib/workflows";

type AgentInfoShape = {
  agent_type?: string;
  provider?: string;
  agent_name?: string;
  model?: string;
  model_version?: string;
};

type KnotWithTopLevelLeaseAgent = KnotRecord & {
  lease_agent?: AgentInfoShape;
};

const workflow = defaultWorkflowDescriptor();

function makeKnot(
  overrides: Partial<KnotWithTopLevelLeaseAgent>,
): KnotWithTopLevelLeaseAgent {
  return {
    id: "KNOT-1",
    title: "Mapped knot",
    state: "implementation",
    profile_id: workflow.id,
    workflow_id: workflow.id,
    updated_at: "2026-05-04T08:00:00.000Z",
    ...overrides,
  };
}

function mapKnot(
  knot: KnotWithTopLevelLeaseAgent,
) {
  return toBeat(
    knot,
    [],
    new Set(),
    new Map(),
    new Map([[workflow.id, workflow]]),
  );
}

describe("Knots backend mapper lease agent metadata", () => {
  it("surfaces top-level lease_agent metadata", () => {
    const beat = mapKnot(makeKnot({
      lease_agent: {
        agent_type: "codex",
        provider: "OpenAI",
        agent_name: "Codex",
        model: "gpt-5",
        model_version: "2026-05-04",
      },
    }));

    expect(beat.metadata?.knotsLeaseAgentInfo).toEqual({
      agent_type: "codex",
      provider: "OpenAI",
      agent_name: "Codex",
      model: "gpt-5",
      model_version: "2026-05-04",
    });
  });

  it("falls back from blank nested lease info to top-level metadata", () => {
    const beat = mapKnot(makeKnot({
      lease: {
        lease_type: "agent",
        nickname: "claim-KNOT-1",
        agent_info: {
          agent_type: "",
          provider: "",
          agent_name: "",
          model: "",
          model_version: "",
        },
      },
      lease_agent: {
        provider: "OpenAI",
        agent_name: "Codex",
        model: "gpt-5",
      },
    }));

    expect(beat.metadata?.knotsLeaseAgentInfo).toEqual({
      provider: "OpenAI",
      agent_name: "Codex",
      model: "gpt-5",
    });
  });

  it("omits empty lease agent metadata", () => {
    const beat = mapKnot(makeKnot({
      lease_agent: {
        agent_type: "",
        provider: " ",
        agent_name: "",
        model: "",
        model_version: "",
      },
    }));

    expect(beat.metadata?.knotsLeaseAgentInfo).toBeUndefined();
  });
});
