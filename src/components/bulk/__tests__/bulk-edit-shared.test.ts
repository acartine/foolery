import { describe, expect, it } from "vitest";
import { normalizeLabel, addLabel } from "../bulk-edit-shared";

describe("normalizeLabel", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeLabel("  triage  ")).toBe("triage");
  });

  it("rejects empty input", () => {
    expect(normalizeLabel("")).toBeNull();
  });

  it("rejects whitespace-only input", () => {
    expect(normalizeLabel("   ")).toBeNull();
  });

  it("preserves internal characters", () => {
    expect(normalizeLabel("p2-batch")).toBe("p2-batch");
  });
});

describe("addLabel", () => {
  it("appends a valid label", () => {
    expect(addLabel(["a"], "b")).toEqual(["a", "b"]);
  });

  it("trims before appending", () => {
    expect(addLabel([], "  triage ")).toEqual(["triage"]);
  });

  it("returns the same reference for empty input (no-op)", () => {
    const existing = ["a"];
    expect(addLabel(existing, "   ")).toBe(existing);
  });

  it("returns the same reference for duplicates (case-sensitive)", () => {
    const existing = ["triage"];
    expect(addLabel(existing, "triage")).toBe(existing);
  });

  it("treats different casing as distinct labels", () => {
    expect(addLabel(["Triage"], "triage")).toEqual(["Triage", "triage"]);
  });
});
