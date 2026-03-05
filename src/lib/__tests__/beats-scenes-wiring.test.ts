import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("beats scenes view wiring", () => {
  it("does not parse or render breakdown as a beats view", () => {
    const pageSource = readSource("src/app/beats/page.tsx");

    expect(pageSource).not.toContain('viewParam === "breakdown"');
    expect(pageSource).not.toContain("BreakdownView");
  });

  it("does not treat breakdown as a top-level header view", () => {
    const headerSource = readSource("src/components/app-header.tsx");

    expect(headerSource).not.toContain('viewParam === "breakdown"');
    expect(headerSource).not.toContain('setBeatsView("breakdown")');
  });

  it("does not route create/detail flows into view=breakdown", () => {
    const createDialogSource = readSource("src/components/create-beat-dialog.tsx");
    const detailSource = readSource("src/components/beat-detail-lightbox.tsx");
    const formSource = readSource("src/components/beat-form.tsx");

    expect(createDialogSource).not.toContain('params.set("view", "breakdown")');
    expect(createDialogSource).not.toContain("onBreakdown=");
    expect(detailSource).not.toContain('params.set("view", "breakdown")');
    expect(formSource).not.toContain("onBreakdown");
  });
});
