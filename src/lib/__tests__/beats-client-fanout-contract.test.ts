import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

describe("beats client fanout contract", () => {
  it("routes list-screen loading through the shared scope-aware fetch helper", () => {
    const source = readSource("src/app/beats/use-beats-query.ts");
    expect(source).toContain("fetchBeatsForScope");
    expect(source).toContain("buildBeatsQueryKey");
    expect(source).not.toContain("registeredRepos.map(async (repo)");
  });

  it("routes Final Cut through the shared scope-aware fetch helper", () => {
    const source = readSource("src/components/final-cut-view.tsx");
    expect(source).toContain("fetchBeatsForScope");
    expect(source).toContain("buildBeatsQueryKey");
    expect(source).not.toContain("Promise.all(");
  });

  it("routes the human-action badge and Retakes through the shared helper", () => {
    const humanCountSource = readSource("src/hooks/use-human-action-count.ts");
    const retakesSource = readSource("src/lib/retake-view-helpers.ts");

    expect(humanCountSource).toContain("fetchBeatsForScope");
    expect(humanCountSource).toContain("buildBeatsQueryKey");
    expect(retakesSource).toContain("fetchBeatsForScope");
    expect(retakesSource).toContain("buildBeatsQueryKey");
    expect(retakesSource).not.toContain("Promise.all(");
  });
});
