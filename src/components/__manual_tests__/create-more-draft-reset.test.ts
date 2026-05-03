import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, "..", relativePath),
    "utf-8",
  );
}

function sliceBetween(
  source: string,
  start: string,
  end: string,
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Unable to locate expected source section");
  }

  return source.slice(startIndex, endIndex);
}

describe("create-more draft reset flow", () => {
  it("keeps beat-form create-more submission free of local draft resets", () => {
    const beatFormSource = readSource("beat-form.tsx");
    const handler = sliceBetween(
      beatFormSource,
      "const handleCreateMoreClick = form.handleSubmit(",
      "  return {",
    );

    expect(handler).not.toContain("clearDraft()");
    expect(handler).not.toContain("setBlocks([])");
    expect(handler).not.toContain("setBlockedBy([])");
    expect(handler).toContain("create.onCreateMore(");
  });

  it("clears the draft immediately before remounting the create-more form", () => {
    const dialogSource = readSource("create-beat-dialog.tsx");
    const handler = sliceBetween(
      dialogSource,
      "function handleCreateMore(",
      "  function handleClear()",
    );
    const clearDraftIndex = handler.indexOf("clearDraft();");
    const setFormKeyIndex = handler.indexOf("setFormKey((k) => k + 1);");

    expect(clearDraftIndex).toBeGreaterThan(-1);
    expect(setFormKeyIndex).toBeGreaterThan(clearDraftIndex);
  });

  it("retains title autofocus on the remounted create form", () => {
    const beatFormSource = readSource("beat-form.tsx");

    expect(beatFormSource).toContain("<Input");
    expect(beatFormSource).toContain("autoFocus");
  });
});
