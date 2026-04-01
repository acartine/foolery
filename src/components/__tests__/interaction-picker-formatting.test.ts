import { describe, expect, it } from "vitest";
import type {
  InteractionItem,
} from "@/components/interaction-picker";
import {
  formatCompactTime,
  formatCompactDate,
  formatConversationLabel,
} from "@/components/interaction-picker-ui";

describe("Interaction Picker Formatting", () => {
  const testTimestamp = "2026-03-31T10:30:45.000Z";

  it("formats time correctly", () => {
    const result = formatCompactTime(testTimestamp);
    // Minutes and seconds are timezone-invariant
    expect(result).toContain("30");
    expect(result).toContain("45");
  });

  it("formats date correctly", () => {
    const result = formatCompactDate(testTimestamp);
    expect(result).toContain("2026");
    expect(result).toContain("Mar");
    expect(result).toContain("31");
  });

  it("formats conversation label with conversation number, session ID, and prompt number", () => {
    const result = formatConversationLabel(1, "session-123", 2);
    expect(result).toBe("#1 session-123 · Prompt #2");
  });

  it("creates interaction item with all required fields", () => {
    const item: InteractionItem = {
      id: "test-id",
      label: "Prompt #1 · Initial prompt",
      source: "initial",
      timestamp: testTimestamp,
      entryId: "test-entry",
      sessionIndex: 0,
      promptNumber: 1,
      conversationNumber: 1,
      sessionId: "session-123",
    };

    expect(item).toHaveProperty("conversationNumber", 1);
    expect(item).toHaveProperty("sessionId", "session-123");
  });
});