/**
 * Manual source-grep test for the scope-refinement notification hook.
 *
 * Reads `src/hooks/use-scope-refinement-notifications.ts` from the real
 * filesystem to assert that the hook wires `markComplete(beatId)` for
 * each completion. Source-grep tests violate the project's Hermetic
 * Test Policy, so this lives here and is excluded from the default
 * suite. Run with `bun run test:manual`.
 *
 * Hermetic store-integration tests are preserved in the matching file
 * under `__tests__/`.
 */

import { describe, expect, it } from "vitest";

describe("scope refinement pending integration – hook source-grep", () => {
  it("hook source calls markComplete for each beatId from completions", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const hookSrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../use-scope-refinement-notifications.ts",
      ),
      "utf-8",
    );

    // Hook subscribes to markComplete from store
    expect(hookSrc).toContain(
      "useScopeRefinementPendingStore",
    );
    expect(hookSrc).toContain(
      "state.markComplete",
    );

    // markComplete is called for each beatId
    expect(hookSrc).toContain(
      "markComplete(beatId)",
    );
    expect(hookSrc).toMatch(
      /for\s*\(\s*const beatId of beatIds\s*\)\s*\{[\s\S]*?markComplete\(beatId\)/,
    );
  });
});
