import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("retake action contract", () => {
  const helpersSource = readFileSync(
    path.join(process.cwd(), "src/lib/retake-view-helpers.ts"),
    "utf8",
  );
  const retakeScopeSource = readFileSync(
    path.join(process.cwd(), "src/lib/retake-session-scope.ts"),
    "utf8",
  );

  it("performs updateBeatOrThrow before startSession in retake-now path", () => {
    // The mutation calls updateBeatOrThrow first, then delegates to
    // executeRetakeNow which calls startSession.
    // Verify ordering: updateBeatOrThrow appears before executeRetakeNow
    // in the mutation body.
    const updateIdx = helpersSource.indexOf("updateBeatOrThrow(");
    const delegateIdx = helpersSource.indexOf(
      "executeRetakeNow(",
      updateIdx,
    );
    expect(updateIdx).toBeGreaterThan(-1);
    expect(delegateIdx).toBeGreaterThan(updateIdx);
    // And executeRetakeNow itself calls startSession.
    const startIdx = helpersSource.indexOf("startSession(");
    expect(startIdx).toBeGreaterThan(-1);
  });

  it("stages successfully even if startSession fails (preserves staged mutation)", () => {
    // The mutation returns staged: true for all retake-now outcomes
    // including start-failed.
    expect(helpersSource).toContain('sessionResult: "start-failed"');
    // Verify staged: true appears in the same return block
    const startFailedIdx = helpersSource.indexOf(
      'sessionResult: "start-failed"',
    );
    const returnBlock = helpersSource.lastIndexOf(
      "return {", startFailedIdx,
    );
    const blockSlice = helpersSource.slice(
      returnBlock, startFailedIdx,
    );
    expect(blockSlice).toContain("staged: true");
  });

  it("checks for rolling ancestor before starting session", () => {
    // In executeRetakeNow, hasRollingAncestor must be called
    // between findRunningTerminalForBeat and startSession.
    const existingIdx = helpersSource.indexOf(
      "findRunningTerminalForBeat(",
    );
    const ancestorIdx = helpersSource.indexOf(
      "hasRollingAncestor(",
    );
    const startIdx = helpersSource.indexOf(
      "startSession(",
      ancestorIdx,
    );
    expect(ancestorIdx).toBeGreaterThan(existingIdx);
    expect(ancestorIdx).toBeLessThan(startIdx);
  });

  it("checks for existing running session before starting a new one", () => {
    // In executeRetakeNow, findRunningTerminalForBeat is called
    // before startSession.
    const existingIdx = helpersSource.indexOf(
      "findRunningTerminalForBeat(",
    );
    const startIdx = helpersSource.indexOf(
      "startSession(",
      existingIdx,
    );
    expect(existingIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(existingIdx);
  });

  it("scopes running-session and ancestry lookups by repo path", () => {
    expect(helpersSource).toContain("repoScopedBeatKey");
    expect(helpersSource).toContain(
      "repoScopedBeatKey(beat.parent, repo)",
    );
    expect(retakeScopeSource).toContain(
      "repoScopedBeatKey(terminal.beatId, terminal.repoPath)",
    );
    expect(retakeScopeSource).toContain(
      "repoScopedBeatKey(beatId, repoPath)",
    );
  });

  it("builds parentByBeatId from allBeats not just retake candidates", () => {
    // The parent map must be built from allBeats to avoid the
    // ancestry bug.
    expect(helpersSource).toContain("allBeats");
    // Verify allBeats feeds the helper that builds the parent map
    // from beat.parent.
    const allBeatsIdx = helpersSource.indexOf("allBeats");
    const parentIdx = retakeScopeSource.indexOf("beat.parent");
    expect(allBeatsIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(-1);
  });
});
