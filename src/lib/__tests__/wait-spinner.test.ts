import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAIT_SPINNER_WORDS,
  formatWaitSpinnerLabel,
  sanitizeWaitSpinnerWords,
} from "@/lib/wait-spinner";

describe("sanitizeWaitSpinnerWords", () => {
  it("returns default words when input is empty", () => {
    expect(sanitizeWaitSpinnerWords(undefined)).toEqual([
      ...DEFAULT_WAIT_SPINNER_WORDS,
    ]);
    expect(sanitizeWaitSpinnerWords([])).toEqual([
      ...DEFAULT_WAIT_SPINNER_WORDS,
    ]);
  });

  it("trims, removes empty values, and deduplicates while preserving order", () => {
    expect(
      sanitizeWaitSpinnerWords([
        "  breakdancing ",
        "",
        "scheming",
        "breakdancing",
        "  ",
        "caffeinating",
      ])
    ).toEqual(["breakdancing", "scheming", "caffeinating"]);
  });
});

describe("formatWaitSpinnerLabel", () => {
  it("cycles dot frames and words", () => {
    expect(formatWaitSpinnerLabel(0, ["a", "b"])).toBe(".a.");
    expect(formatWaitSpinnerLabel(1, ["a", "b"])).toBe("..a..");
    expect(formatWaitSpinnerLabel(2, ["a", "b"])).toBe("...a...");
    expect(formatWaitSpinnerLabel(3, ["a", "b"])).toBe("..a..");
    expect(formatWaitSpinnerLabel(4, ["a", "b"])).toBe(".b.");
  });

  it("normalizes invalid step values", () => {
    expect(formatWaitSpinnerLabel(-9, ["a"])).toBe(".a.");
    expect(formatWaitSpinnerLabel(Number.NaN, ["a"])).toBe(".a.");
    expect(formatWaitSpinnerLabel(Number.POSITIVE_INFINITY, ["a"])).toBe(".a.");
  });

  it("falls back to waiting label when custom words sanitize to none", () => {
    expect(formatWaitSpinnerLabel(0, ["", "   "])).toBe("...waiting...");
  });
});
