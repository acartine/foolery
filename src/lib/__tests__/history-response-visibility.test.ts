import { describe, expect, it } from "vitest";
import { shouldShowHistoryResponseType } from "@/lib/history-response-visibility";

describe("shouldShowHistoryResponseType", () => {
  it("shows assistant responses when detail is off", () => {
    expect(shouldShowHistoryResponseType("assistant", false)).toBe(true);
  });

  it("hides result responses when detail is off", () => {
    expect(shouldShowHistoryResponseType("result", false)).toBe(false);
  });

  it("hides non-assistant response types when detail is off", () => {
    expect(shouldShowHistoryResponseType("user", false)).toBe(false);
    expect(shouldShowHistoryResponseType("system", false)).toBe(false);
    expect(shouldShowHistoryResponseType("stream_event", false)).toBe(false);
  });

  it("shows all response types when detail is on", () => {
    expect(shouldShowHistoryResponseType("assistant", true)).toBe(true);
    expect(shouldShowHistoryResponseType("result", true)).toBe(true);
    expect(shouldShowHistoryResponseType("user", true)).toBe(true);
    expect(shouldShowHistoryResponseType("system", true)).toBe(true);
  });
});
