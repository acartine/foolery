import path from "node:path";
import { readFileSync } from "node:fs";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { PlanSummaryCard } from "@/components/setlist-view";
import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { SetlistPlanPreview } from "@/lib/setlist-chart";

type ElementWithProps = ReactElement<{
  children?: ReactNode;
  className?: string;
}>;

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!node || typeof node === "boolean") {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join("");
  }
  if (!isValidElement(node)) return "";
  return flattenText((node as ElementWithProps).props.children);
}

function collectClassNames(node: ReactNode): string[] {
  if (!node || typeof node === "boolean") return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectClassNames(child));
  }
  if (!isValidElement(node)) return [];

  const element = node as ElementWithProps;
  return [
    ...(element.props.className ? [element.props.className] : []),
    ...Children.toArray(element.props.children).flatMap((child) =>
      collectClassNames(child)
    ),
  ];
}

function makePlanSummary(): PlanSummary {
  return {
    artifact: {
      id: "maestro-d6c6",
      type: "execution_plan",
      state: "orchestration",
      workflowId: "execution_plan_sdlc",
      createdAt: "2026-04-19T00:00:00Z",
      updatedAt: "2026-04-19T00:00:00Z",
    },
    plan: {
      repoPath: "/Users/cartine/maestro",
      beatIds: ["maestro-1", "maestro-2", "maestro-3", "maestro-4"],
      objective: "Migrate AWS infra",
      summary: "AWS to Hetzner Migration",
      mode: "groom",
      model: "claude-opus-4",
    },
  };
}

function makePreview(): SetlistPlanPreview {
  return {
    id: "maestro-d6c6",
    summary: "AWS to Hetzner Migration",
    objective: "Migrate AWS infra",
    totalBeats: 4,
    previewBeats: [
      { id: "maestro-1", label: "maestro-1", title: "Preview beat one" },
      { id: "maestro-2", label: "maestro-2", title: "Preview beat two" },
      { id: "maestro-3", label: "maestro-3", title: "Preview beat three" },
    ],
    remainingBeats: 1,
  };
}

describe("PlanSummaryCard", () => {
  it("does not render preview beat rows for unselected plans", () => {
    const tree = PlanSummaryCard({
      plan: makePlanSummary(),
      preview: makePreview(),
      selected: false,
      selectedWorkableBeatCount: null,
      onSelect: vi.fn(),
    });

    const text = flattenText(tree);

    expect(text).toContain("AWS to Hetzner Migration");
    expect(text).toContain("4 beats");
    expect(text).toContain("groom");
    expect(text).not.toContain("Preview beat one");
    expect(text).not.toContain("Preview beat two");
    expect(text).not.toContain("Preview beat three");
    expect(text).not.toContain("+1 more beat");
  });

  it("keeps selected and unselected cards on the same content structure", () => {
    const selectedTree = PlanSummaryCard({
      plan: makePlanSummary(),
      preview: makePreview(),
      selected: true,
      selectedWorkableBeatCount: 2,
      onSelect: vi.fn(),
    });
    const unselectedTree = PlanSummaryCard({
      plan: makePlanSummary(),
      preview: makePreview(),
      selected: false,
      selectedWorkableBeatCount: null,
      onSelect: vi.fn(),
    });

    const selectedClasses = collectClassNames(selectedTree).join(" ");
    const unselectedText = flattenText(unselectedTree);
    const selectedText = flattenText(selectedTree);

    expect(selectedText).toContain("Selected");
    expect(selectedText).toContain("2 remaining");
    expect(unselectedText).toContain("Execution plan");
    expect(unselectedText).toContain("4 beats");
    expect(selectedClasses).toContain("bg-primary/[0.03]");
    expect(selectedClasses).toContain("border-primary/35");
  });
});

describe("setlist-view source contract", () => {
  it("does not keep an unselected-only preview branch", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/setlist-view.tsx"),
      "utf8",
    );

    expect(source).not.toContain("preview.previewBeats.map");
    expect(source).not.toContain("preview.remainingBeats > 0");
    expect(source).not.toContain("{!selected && (");
  });
});
