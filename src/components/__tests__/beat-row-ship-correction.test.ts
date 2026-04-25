import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../beat-column-defs-extra.tsx"),
    "utf-8",
  );
}

describe("Queue row state dropdown - Shipped correction", () => {
  const src = readSource();

  it("adds a correction section for terminal targets", () => {
    expect(src).toContain(
      "const terminals = workflow.terminalStates ?? [];",
    );
    expect(src).toContain("Correction");
    expect(src).toContain(
      "if (terminals.length === 0) return null;",
    );
  });

  it("renders terminal state items from the workflow descriptor", () => {
    expect(src).toContain("terminals.map((terminal) => (");
    expect(src).toContain("key={`correction-${terminal}`}");
    expect(src).toContain("{formatStateName(terminal)}");
  });

  it("routes correction selections through the row update handler", () => {
    expect(src).toContain("onSelect={() =>");
    expect(src).toContain("{ state: terminal }");
    expect(src).toContain("repoPathForBeat(beat)");
  });
});
