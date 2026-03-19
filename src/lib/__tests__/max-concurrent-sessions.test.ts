import { describe, expect, it } from "vitest";
import {
  clampMaxConcurrentSessions,
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  MAX_MAX_CONCURRENT_SESSIONS,
  MIN_MAX_CONCURRENT_SESSIONS,
} from "@/lib/max-concurrent-sessions";

describe("clampMaxConcurrentSessions", () => {
  it("falls back to the default when the value is missing", () => {
    expect(clampMaxConcurrentSessions(undefined)).toBe(
      DEFAULT_MAX_CONCURRENT_SESSIONS,
    );
  });

  it("clamps values to the supported range", () => {
    expect(clampMaxConcurrentSessions(0)).toBe(MIN_MAX_CONCURRENT_SESSIONS);
    expect(clampMaxConcurrentSessions(99)).toBe(MAX_MAX_CONCURRENT_SESSIONS);
  });

  it("truncates decimal values", () => {
    expect(clampMaxConcurrentSessions(7.9)).toBe(7);
  });
});
