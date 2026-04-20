import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { actionColumn } from "@/components/beat-column-defs-extra";
import { ownerTypeColumn } from "@/components/beat-column-defs";
import { WaveSection } from "@/components/wave-planner-sections";
import type { Beat, Wave } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-gate-1",
    title: "Gate beat",
    type: "gate",
    state: "ready_for_plan_review",
    nextActionOwnerKind: "agent",
    requiresHumanAction: false,
    isAgentClaimable: true,
    priority: 2,
    labels: [],
    created: "2026-04-20T00:00:00.000Z",
    updated: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function renderNode(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(Fragment, null, node),
  );
}

function renderCell(
  cell: unknown,
  beat: Beat,
): string {
  if (typeof cell !== "function") {
    throw new Error("Expected cell renderer");
  }
  return renderNode(
    cell({
      row: { original: beat },
    } as never),
  );
}

describe("gate owner claimability UI affordances", () => {
  it("renders Take! for agent-owned gate beats in the table action column", () => {
    const onShipBeat = vi.fn();
    const column = actionColumn({
      onShipBeat,
      shippingByBeatId: {},
      collapsedIds: new Set<string>(),
      childCountMap: new Map<string, number>(),
      parentRollingBeatIds: new Set<string>(),
      agentInfoByBeatId: {},
    });

    const html = renderCell(column.cell, makeBeat());

    expect(html).toContain("Take!");
  });

  it("shows owner badges for gate beats based on the next owner", () => {
    const column = ownerTypeColumn();

    const agentHtml = renderCell(column.cell, makeBeat());
    const humanHtml = renderCell(
      column.cell,
      makeBeat({
        id: "foolery-gate-2",
        nextActionOwnerKind: "human",
      }),
    );

    expect(agentHtml).toContain("Agent");
    expect(humanHtml).toContain("Human");
  });

  it("keeps runnable gate beats actionable in the wave planner", () => {
    const wave: Wave = {
      level: 0,
      beats: [
        {
          id: "foolery-gate-wave",
          aliases: ["gate-wave"],
          title: "Plan review gate",
          type: "gate",
          state: "open",
          nextActionOwnerKind: "agent",
          requiresHumanAction: false,
          isAgentClaimable: true,
          priority: 1,
          labels: [],
          blockedBy: [],
          readiness: "runnable",
          readinessReason: "Ready to ship.",
          waveLevel: 0,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(WaveSection, {
        wave,
        planBeatAliases: new Map(),
        shippingByBeatId: {},
        onShip: () => undefined,
      }),
    );

    expect(html).toContain("Take!");
  });
});
