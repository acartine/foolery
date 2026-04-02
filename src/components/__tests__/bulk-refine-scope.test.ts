import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Source-code verification tests for the bulk Refine Scope
 * action in Queues multi-select mode.
 */

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../filter-bar.tsx"),
    "utf-8",
  );
}

function bulkSection(src: string): string {
  const start = src.indexOf("export function BulkEditControls");
  if (start === -1) {
    throw new Error(
      "BulkEditControls function not found",
    );
  }
  const end = src.indexOf("function FilterControls");
  return src.slice(start, end);
}

describe("BulkEditControls – Refine Scope button", () => {
  const src = readSource();

  it("adds onRefineScope prop and forwards it from FilterBar", () => {
    expect(src).toContain("onRefineScope?: (ids: string[]) => void;");
    expect(src).toContain("onRefineScope,");
    expect(src).toContain("onRefineScope={onRefineScope}");
  });

  it("renders Refine Scope action using title-bar-aligned button styling", () => {
    const section = bulkSection(src);
    expect(section).toContain('title="Re-run scope refinement for selected beats"');
    expect(section).toContain(
      '<RefreshCw className="size-4" />',
    );
    expect(section).toContain('variant="success-light"');
    expect(section).toContain('size="lg"');
    expect(section).toContain("Refine Scope");
  });

  it("calls onRefineScope(selectedIds) on click", () => {
    const section = bulkSection(src);
    expect(section).toContain("onClick={() => onRefineScope(selectedIds)}");
  });
});
