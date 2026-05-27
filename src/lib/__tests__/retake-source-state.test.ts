import { describe, expect, it } from "vitest";
import { isRetakeEligibleType, isRetakeSourceState } from "@/lib/retake";

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

describe("isRetakeEligibleType", () => {
  it("accepts work-type knots", () => {
    expect(isRetakeEligibleType("work")).toBe(true);
  });

  it("excludes lease, gate, and exploration knot types", () => {
    expect(isRetakeEligibleType("lease")).toBe(false);
    expect(isRetakeEligibleType("gate")).toBe(false);
    expect(isRetakeEligibleType("exploration")).toBe(false);
  });

  it("normalizes case and whitespace on excluded types", () => {
    expect(isRetakeEligibleType("  LEASE ")).toBe(false);
    expect(isRetakeEligibleType("Gate")).toBe(false);
    expect(isRetakeEligibleType("EXPLORATION")).toBe(false);
  });

  it("accepts non-knot beat types so BD repos are unaffected", () => {
    expect(isRetakeEligibleType("task")).toBe(true);
    expect(isRetakeEligibleType("bug")).toBe(true);
    expect(isRetakeEligibleType("feature")).toBe(true);
    expect(isRetakeEligibleType("chore")).toBe(true);
  });

  it("treats missing/empty types as eligible", () => {
    expect(isRetakeEligibleType("")).toBe(true);
    expect(isRetakeEligibleType(undefined)).toBe(true);
    expect(isRetakeEligibleType(null)).toBe(true);
  });
});
