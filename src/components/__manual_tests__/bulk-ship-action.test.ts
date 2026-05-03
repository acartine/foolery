import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

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

describe("BulkEditControls - Ship action", () => {
  const src = readSource();

  it("forwards the queue view phase into bulk actions", () => {
    expect(src).toContain("viewPhase?: ViewPhase;");
    expect(src).toContain("viewPhase={viewPhase}");
  });

  it("renders a queue-only Ship button with action-bar styling", () => {
    const section = bulkSection(src);
    expect(section).toContain('viewPhase === "queues"');
    expect(section).toContain('title="Ship selected beats"');
    expect(section).toContain('<Check className="size-4" />Ship');
    expect(section).toContain('variant="success-light"');
    expect(section).toContain('size="lg"');
  });

  it("wires Ship directly to the shipped bulk update payload", () => {
    const section = bulkSection(src);
    expect(section).toContain("const handleShip = useCallback(() => {");
    expect(section).toContain('onBulkUpdate({ state: "shipped" });');
    expect(section).toContain("onShip={handleShip}");
    expect(section).toContain("onClick={onShip}");
  });
});
