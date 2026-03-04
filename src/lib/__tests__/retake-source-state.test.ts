import { describe, expect, it } from "vitest";
import { isRetakeSourceState } from "@/lib/retake";

describe("isRetakeSourceState", () => {
  it("accepts shipped and legacy closed aliases", () => {
    expect(isRetakeSourceState("shipped")).toBe(true);
    expect(isRetakeSourceState("closed")).toBe(true);
    expect(isRetakeSourceState("done")).toBe(true);
    expect(isRetakeSourceState("approved")).toBe(true);
  });

  it("normalizes case and whitespace", () => {
    expect(isRetakeSourceState("  SHIPPED ")).toBe(true);
  });

  it("rejects non-retake source states", () => {
    expect(isRetakeSourceState("ready_for_implementation")).toBe(false);
    expect(isRetakeSourceState("abandoned")).toBe(false);
    expect(isRetakeSourceState("")).toBe(false);
    expect(isRetakeSourceState(undefined)).toBe(false);
    expect(isRetakeSourceState(null)).toBe(false);
  });
});
