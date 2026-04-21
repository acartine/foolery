import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

function findAdHocBeatInvalidations(
  dir: string,
): string[] {
  const hits: string[] = [];

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;

    const fullPath = path.join(
      entry.parentPath,
      entry.name,
    );
    if (fullPath.includes("__tests__")) continue;
    if (fullPath.includes("node_modules")) continue;
    if (fullPath.endsWith("beat-query-cache.ts")) continue;

    const source = fs.readFileSync(
      fullPath,
      "utf8",
    );
    const lines = source.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes("invalidateQueries")) {
        continue;
      }
      const nearby = lines
        .slice(index, index + 4)
        .join("\n");
      if (/queryKey:\s*\["beats"\]/.test(nearby)) {
        hits.push(path.relative(SRC, fullPath));
        break;
      }
    }
  }

  return hits.sort();
}

describe("beat invalidation consistency", () => {
  it("routes beat list invalidations through beat-query-cache", () => {
    expect(findAdHocBeatInvalidations(SRC)).toEqual(
      [],
    );
  });

  it("lets selected background refresh paths use the shared beat helper", () => {
    const sessionSource = fs.readFileSync(
      path.join(
        SRC,
        "lib/session-connection-manager.ts",
      ),
      "utf8",
    );
    const scopeRefinementSource = fs.readFileSync(
      path.join(
        SRC,
        "hooks/use-scope-refinement-notifications.ts",
      ),
      "utf8",
    );

    expect(sessionSource).toContain(
      "invalidateBeatListQueries",
    );
    expect(scopeRefinementSource).not.toContain(
      "invalidateBeatListQueries",
    );
  });

  it("keeps user mutation surfaces on the shared beat helper", () => {
    const mutationFiles = [
      "app/beats/use-beat-detail.ts",
      "app/beats/use-bulk-actions.ts",
      "components/app-header.tsx",
      "components/create-beat-dialog.tsx",
      "components/merge-beats-dialog.tsx",
      "components/settings-repos-section.tsx",
      "components/use-beat-detail-data.ts",
      "lib/retake-view-helpers.ts",
    ];

    for (const file of mutationFiles) {
      const source = fs.readFileSync(
        path.join(SRC, file),
        "utf8",
      );
      expect(source).toContain(
        "beat-query-cache",
      );
    }
  });
});
