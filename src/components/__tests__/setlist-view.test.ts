import path from "node:path";
import { readFileSync } from "node:fs";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { PlanSummaryCard } from "@/components/plan-summary-card";
import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { SetlistPlanPreview } from "@/lib/setlist-chart";

type ElementWithProps = ReactElement<{
  children?: ReactNode;
  className?: string;
}>;

function expandElement(element: ReactElement): ReactNode {
  if (typeof element.type !== "function") return element;
  const Component = element.type as (props: unknown) => ReactNode;
  return Component(element.props);
}

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
  if (typeof node.type === "function") {
    return flattenText(expandElement(node));
  }
  return flattenText((node as ElementWithProps).props.children);
}

function collectClassNames(node: ReactNode): string[] {
  if (!node || typeof node === "boolean") return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectClassNames(child));
  }
  if (!isValidElement(node)) return [];

  if (typeof node.type === "function") {
    return collectClassNames(expandElement(node));
  }

  const element = node as ElementWithProps;
  return [
    ...(element.props.className ? [element.props.className] : []),
    ...Children.toArray(element.props.children).flatMap((child) =>
      collectClassNames(child)
    ),
  ];
}

function collectParagraphs(node: ReactNode): Array<{
  className?: string;
  text: string;
}> {
  if (!node || typeof node === "boolean") return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectParagraphs(child));
  }
  if (!isValidElement(node)) return [];

  if (typeof node.type === "function") {
    return collectParagraphs(expandElement(node));
  }

  const element = node as ElementWithProps;
  const children = Children.toArray(element.props.children);
  const paragraphs = element.type === "p"
    ? [{
      className: element.props.className,
      text: flattenText(children),
    }]
    : [];

  return [
    ...paragraphs,
    ...children.flatMap((child) => collectParagraphs(child)),
  ];
}

function findByTestId(
  node: ReactNode,
  testId: string,
): ReactElement | null {
  if (!node || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{
    children?: ReactNode;
    "data-testid"?: string;
  }>;
  if (element.props["data-testid"] === testId) return element;
  if (typeof element.type === "function") {
    return findByTestId(expandElement(element), testId);
  }
  return findByTestId(element.props.children ?? null, testId);
}

function makePlanSummary(
  overrides: Partial<PlanSummary["artifact"]> = {},
): PlanSummary {
  return {
    artifact: {
      id: "maestro-d6c6",
      type: "execution_plan",
      state: "orchestration",
      workflowId: "execution_plan_sdlc",
      createdAt: "2026-04-19T00:00:00Z",
      updatedAt: "2026-04-19T00:00:00Z",
      ...overrides,
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

function defaultProps() {
  return {
    plan: makePlanSummary(),
    preview: makePreview(),
    selected: false,
    workableBeatCount: 4,
    canComplete: false,
    isCompleting: false,
    onSelect: vi.fn(),
    onComplete: vi.fn(),
  };
}

describe("PlanSummaryCard", () => {
  it("does not render preview beat rows for unselected plans", () => {
    const tree = PlanSummaryCard(defaultProps());

    const text = flattenText(tree);

    expect(text).toContain("AWS to Hetzner Migration");
    expect(text).toContain("4 remaining");
    expect(text).toContain("groom");
    expect(text).not.toContain("Preview beat one");
    expect(text).not.toContain("Preview beat two");
    expect(text).not.toContain("Preview beat three");
    expect(text).not.toContain("+1 more beat");
  });

  it("renders the same workable count for selected and unselected cards", () => {
    const props = defaultProps();
    const selectedTree = PlanSummaryCard({
      ...props,
      selected: true,
      workableBeatCount: 2,
    });
    const unselectedTree = PlanSummaryCard({
      ...props,
      selected: false,
      workableBeatCount: 2,
    });

    const selectedClasses = collectClassNames(selectedTree).join(" ");
    const unselectedText = flattenText(unselectedTree);
    const selectedText = flattenText(selectedTree);

    expect(selectedText).toContain("Selected");
    expect(selectedText).toContain("2 remaining");
    expect(unselectedText).toContain("Execution plan");
    expect(unselectedText).toContain("2 remaining");
    expect(selectedClasses).toContain("bg-primary/[0.03]");
    expect(selectedClasses).toContain("border-primary/35");
  });

  it("shows the Done badge when no beats remain", () => {
    const tree = PlanSummaryCard({
      ...defaultProps(),
      workableBeatCount: 0,
    });

    expect(findByTestId(tree, "plan-done-badge")).not.toBeNull();
    expect(flattenText(tree)).toContain("Done");
    expect(flattenText(tree)).toContain("0 remaining");
  });

  it("hides the Done badge when work remains", () => {
    const tree = PlanSummaryCard({
      ...defaultProps(),
      workableBeatCount: 3,
    });

    expect(findByTestId(tree, "plan-done-badge")).toBeNull();
  });

  it("shows the Complete button when canComplete is true", () => {
    const tree = PlanSummaryCard({
      ...defaultProps(),
      workableBeatCount: 0,
      canComplete: true,
    });

    expect(findByTestId(tree, "plan-complete-button")).not.toBeNull();
    expect(flattenText(tree)).toContain("Complete plan");
  });

  it("hides the Complete button once the plan is already terminal", () => {
    const tree = PlanSummaryCard({
      ...defaultProps(),
      workableBeatCount: 0,
      canComplete: false,
    });

    expect(findByTestId(tree, "plan-complete-button")).toBeNull();
  });

  it("disables the Complete button while completion is in flight", () => {
    const tree = PlanSummaryCard({
      ...defaultProps(),
      workableBeatCount: 0,
      canComplete: true,
      isCompleting: true,
    });

    const button = findByTestId(tree, "plan-complete-button") as
      | ReactElement<{ disabled?: boolean }>
      | null;
    expect(button).not.toBeNull();
    expect(button?.props.disabled).toBe(true);
    expect(flattenText(tree)).toContain("Completing");
  });

  it("renders the objective as the primary line and the summary as secondary copy", () => {
    const tree = PlanSummaryCard(defaultProps());

    const paragraphs = collectParagraphs(tree);

    expect(paragraphs[0]?.text).toBe("Migrate AWS infra");
    expect(paragraphs[0]?.className).toContain("text-base font-semibold");
    expect(paragraphs[1]).toMatchObject({
      className: "mt-1 text-sm text-muted-foreground",
      text: "AWS to Hetzner Migration",
    });
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

describe("plan-summary-card source contract", () => {
  const cardSource = readFileSync(
    path.join(process.cwd(), "src/components/plan-summary-card.tsx"),
    "utf8",
  );

  it("uses role=button on a div root, not a nested <button> wrapper", () => {
    expect(cardSource).toContain('role="button"');
    expect(cardSource).not.toMatch(/<button[\s\S]*?type="button"[\s\S]*?onClick={\(\) => onSelect/);
  });

  it("stops propagation on the Complete button click", () => {
    expect(cardSource).toContain("event.stopPropagation()");
  });
});
