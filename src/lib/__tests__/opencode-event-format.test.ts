/**
 * Hermetic tests for formatOpenCodeEvent — the renderer
 * for OpenCode-native lifecycle events that do not flow
 * through Claude-shape normalization.
 */
import { describe, it, expect } from "vitest";
import {
  formatOpenCodeEvent,
} from "@/lib/opencode-event-format";

function plain(text: string): string {
  return text.replace(
    new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"),
    "",
  );
}

describe("formatOpenCodeEvent", () => {
  it("renders reasoning text in magenta", () => {
    const out = formatOpenCodeEvent({
      type: "reasoning",
      text: "thinking…",
    });
    expect(out).not.toBeNull();
    expect(out!.isDetail).toBe(true);
    expect(plain(out!.text)).toContain("thinking…");
  });

  it("returns null for empty reasoning", () => {
    expect(formatOpenCodeEvent({
      type: "reasoning",
      text: "",
    })).toBeNull();
  });

  it("renders step_updated with status label", () => {
    const out = formatOpenCodeEvent({
      type: "step_updated",
      step: { name: "review", status: "running" },
    });
    expect(out).not.toBeNull();
    expect(plain(out!.text)).toContain("step review running");
  });

  it("returns null for empty step_updated", () => {
    expect(formatOpenCodeEvent({
      type: "step_updated",
      step: {},
    })).toBeNull();
  });

  it("renders session_idle", () => {
    const out = formatOpenCodeEvent({
      type: "session_idle",
      sessionID: "ses_X",
    });
    expect(plain(out!.text)).toContain("session idle ses_X");
  });

  it("renders session_error with high-visibility marker", () => {
    const out = formatOpenCodeEvent({
      type: "session_error",
      message: "rate limited",
    });
    expect(out!.isDetail).toBe(false);
    expect(plain(out!.text)).toContain("rate limited");
  });

  it("renders file with mime tag", () => {
    const out = formatOpenCodeEvent({
      type: "file",
      filename: "/tmp/x.png",
      mime: "image/png",
    });
    expect(plain(out!.text))
      .toContain("/tmp/x.png");
    expect(plain(out!.text)).toContain("image/png");
  });

  it("returns null for file without filename", () => {
    expect(formatOpenCodeEvent({
      type: "file",
      filename: "",
    })).toBeNull();
  });

  it("renders snapshot truncated", () => {
    const long = "a".repeat(100);
    const out = formatOpenCodeEvent({
      type: "snapshot",
      snapshot: long,
    });
    expect(plain(out!.text)).toContain("snapshot ");
    expect(plain(out!.text).length)
      .toBeLessThan(long.length + 32);
  });

  it("renders message_updated only when time.completed is set", () => {
    const out = formatOpenCodeEvent({
      type: "message_updated",
      info: { time: { completed: 999 } },
    });
    expect(plain(out!.text)).toContain("turn complete");
  });

  it("returns null for message_updated without completed", () => {
    expect(formatOpenCodeEvent({
      type: "message_updated",
      info: { time: {} },
    })).toBeNull();
  });

  it("returns null for an unrelated event type", () => {
    expect(formatOpenCodeEvent({
      type: "tool_use",
      name: "Bash",
    })).toBeNull();
  });
});
