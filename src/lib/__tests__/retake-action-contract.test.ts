import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("retake action contract", () => {
  const retakesViewSource = readFileSync(
    path.join(process.cwd(), "src/components/retakes-view.tsx"),
    "utf8",
  );

  it("performs updateBeatOrThrow before startSession in retake-now path", () => {
    // The mutation must call updateBeatOrThrow first, then startSession.
    // Verify ordering: updateBeatOrThrow appears before startSession in the mutation body.
    const updateIdx = retakesViewSource.indexOf("updateBeatOrThrow(beats");
    const startIdx = retakesViewSource.indexOf("startSession(beat.id");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(startIdx);
  });

  it("stages successfully even if startSession fails (preserves staged mutation)", () => {
    // The mutation returns staged: true for all retake-now outcomes including start-failed.
    expect(retakesViewSource).toContain('"start-failed" as const');
    // Verify staged: true appears in the same return block
    const startFailedIdx = retakesViewSource.indexOf('"start-failed" as const');
    const returnBlock = retakesViewSource.lastIndexOf("return {", startFailedIdx);
    const blockSlice = retakesViewSource.slice(returnBlock, startFailedIdx);
    expect(blockSlice).toContain("staged: true");
  });

  it("checks for rolling ancestor before starting session", () => {
    // hasRollingAncestor must be called between updateBeatOrThrow and startSession
    const updateIdx = retakesViewSource.indexOf("updateBeatOrThrow(beats");
    const ancestorIdx = retakesViewSource.indexOf("hasRollingAncestor(");
    const startIdx = retakesViewSource.indexOf("startSession(beat.id");
    expect(ancestorIdx).toBeGreaterThan(updateIdx);
    expect(ancestorIdx).toBeLessThan(startIdx);
  });

  it("checks for existing running session before starting a new one", () => {
    const updateIdx = retakesViewSource.indexOf("updateBeatOrThrow(beats");
    const existingIdx = retakesViewSource.indexOf("terminals.find");
    expect(existingIdx).toBeGreaterThan(updateIdx);
  });

  it("scopes running-session and ancestry lookups by repo path", () => {
    expect(retakesViewSource).toContain("repoScopedBeatKey");
    expect(retakesViewSource).toContain("t.repoPath === repo");
    expect(retakesViewSource).toContain("repoScopedBeatKey(beat.parent, repo)");
    expect(retakesViewSource).toContain("repoScopedBeatKey(terminal.beatId, terminal.repoPath)");
  });

  it("builds parentByBeatId from allBeats not just retake candidates", () => {
    // The parent map must be built from allBeats to avoid the ancestry bug
    expect(retakesViewSource).toContain("allBeats");
    // Verify allBeats is used to build the parent map that references beat.parent
    const allBeatsIdx = retakesViewSource.indexOf("allBeats");
    const parentIdx = retakesViewSource.indexOf("beat.parent", allBeatsIdx);
    expect(allBeatsIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(allBeatsIdx);
  });
});
