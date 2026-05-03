import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(rel: string): string {
  return readFileSync(
    path.join(process.cwd(), rel),
    "utf8",
  );
}

describe("setlist query key contract", () => {
  const setlistViewDataSource = source(
    "src/components/setlist-view-data.ts",
  );

  it("reuses the shared beats query namespace for repo beat data", () => {
    expect(setlistViewDataSource).toContain(
      'buildBeatsQueryKey("setlist", {}, repoScope)',
    );
    expect(setlistViewDataSource).not.toContain(
      'queryKey: ["setlist-beats", repoPath]',
    );
  });

  it("keeps the missing-knot fallback that fetches beat detail by id", () => {
    expect(setlistViewDataSource).toContain(
      "selectedPlanRecord.plan.beatIds.filter(",
    );
    expect(setlistViewDataSource).toContain(
      "(beatId) => !beatMap.has(beatId)",
    );
    expect(setlistViewDataSource).toContain(
      'queryKey: ["setlist-plan-beat", repoPath, beatId]',
    );
    expect(setlistViewDataSource).toContain(
      "queryFn: () => fetchBeat(beatId, repoPath)",
    );
  });
});
