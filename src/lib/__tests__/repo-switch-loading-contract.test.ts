import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(rel: string): string {
  return readFileSync(
    path.join(process.cwd(), rel),
    "utf8",
  );
}

describe("repo switch loading contract", () => {
  const beatsQuerySource = source(
    "src/app/beats/use-beats-query.ts",
  );
  const finalCutSource = source(
    "src/components/final-cut-view.tsx",
  );
  const retakesQuerySource = source(
    "src/lib/retake-view-helpers.ts",
  );
  const retakesViewSource = source(
    "src/components/retakes-view.tsx",
  );
  const beatsPageSource = source(
    "src/app/beats/page.tsx",
  );
  const beatDetailSource = source(
    "src/app/beats/use-beat-detail.ts",
  );
  const loadingStateSource = source(
    "src/components/repo-switch-loading-state.tsx",
  );

  it("does not keep previous repo-scoped query data during a repo change", () => {
    expect(beatsQuerySource).not.toContain(
      "placeholderData: keepPreviousData",
    );
    expect(finalCutSource).not.toContain(
      "placeholderData: keepPreviousData",
    );
    expect(retakesQuerySource).not.toContain(
      "placeholderData: keepPreviousData",
    );
  });

  it("renders explicit repo-switch loading placeholders for each affected view", () => {
    expect(beatsPageSource).toContain(
      'data-testid="repo-switch-loading-beats"',
    );
    expect(finalCutSource).toContain(
      'data-testid="repo-switch-loading-finalcut"',
    );
    expect(retakesViewSource).toContain(
      'data-testid="repo-switch-loading-retakes"',
    );
  });

  it("marks the loading placeholder as busy for assistive tech", () => {
    expect(loadingStateSource).toContain(
      'role="status"',
    );
    expect(loadingStateSource).toContain(
      'aria-busy="true"',
    );
    expect(loadingStateSource).toContain(
      "LoaderCircle",
    );
  });

  it("clears an open beat detail when the selected repo changes", () => {
    expect(beatDetailSource).toContain(
      "const previousActiveRepoRef = useRef(activeRepo);",
    );
    expect(beatDetailSource).toContain(
      "if (previousActiveRepoRef.current === activeRepo) {",
    );
    expect(beatDetailSource).toContain(
      'setBeatDetailParams(null, undefined, "replace");',
    );
  });
});
