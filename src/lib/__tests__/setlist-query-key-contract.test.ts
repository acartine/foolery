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
  const setlistViewSource = source(
    "src/components/setlist-view.tsx",
  );

  it("reuses the shared beats query namespace for repo beat data", () => {
    expect(setlistViewSource).toContain(
      'buildBeatsQueryKey("setlist", {}, repoScope)',
    );
    expect(setlistViewSource).not.toContain(
      'queryKey: ["setlist-beats", repoPath]',
    );
  });

  it("keeps the missing-knot fallback that fetches beat detail by id", () => {
    expect(setlistViewSource).toContain(
      "selectedPlanRecord.plan.beatIds.filter(",
    );
    expect(setlistViewSource).toContain(
      "(beatId) => !beatMap.has(beatId)",
    );
    expect(setlistViewSource).toContain(
      'queryKey: ["setlist-plan-beat", repoPath, beatId]',
    );
    expect(setlistViewSource).toContain(
      "queryFn: () => fetchBeat(beatId, repoPath)",
    );
  });
});
