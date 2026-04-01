import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Source-code verification tests for the new bulk refine
 * scope hook integration in useBeatActions.
 */

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../use-beat-actions.ts"),
    "utf-8",
  );
}

describe("useBeatActions – bulk refine scope", () => {
  const src = readSource();

  it("imports refineBeatScope and scope refinement pending store", () => {
    expect(src).toContain("refineBeatScope");
    expect(src).toContain(
      "useScopeRefinementPendingStore",
    );
  });

  it("adds handleRefineScope to hook result", () => {
    expect(src).toContain("handleRefineScope:");
    expect(src).toContain("handleRefineScope,");
    expect(src).toContain("handleRefineScope: (ids: string[]) => Promise<void>;");
  });

  it("uses Promise.allSettled with per-beat refine scope calls", () => {
    expect(src).toContain("Promise.allSettled(");
    expect(src).toContain("refineBeatScope(id, repoPath)");
  });

  it("marks successful refinements as pending", () => {
    expect(src).toContain("markPending(target.id);");
  });

  it("reports a single summary toast for successes and failures", () => {
    expect(src).toContain("toast.success(");
    expect(src).toContain("toast.error(");
  });
});
