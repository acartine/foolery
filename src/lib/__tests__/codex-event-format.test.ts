import { describe, it, expect } from "vitest";
import {
  formatCodexEvent,
} from "@/lib/codex-event-format";

function strip(text: string): string {
  // Strip ANSI escape sequences to make assertions
  // readable.
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatCodexEvent: turn lifecycle", () => {
  it("formats turn.started as a marker line", () => {
    const result = formatCodexEvent({
      type: "turn.started",
    });
    expect(result?.isDetail).toBe(true);
    expect(strip(result!.text)).toBe(
      "▷ turn started\n",
    );
  });

  it("formats turn.completed as a marker", () => {
    const result = formatCodexEvent({
      type: "turn.completed",
    });
    expect(strip(result!.text)).toBe(
      "▷ turn completed\n",
    );
  });

  it(
    "formats turn.failed with error message visibly",
    () => {
      const result = formatCodexEvent({
        type: "turn.failed",
        error: { message: "rate limited" },
      });
      // turn.failed must NOT be hidden behind detail
      // toggle — the user has to see failures.
      expect(result?.isDetail).toBe(false);
      expect(strip(result!.text)).toContain(
        "✗ turn failed: rate limited",
      );
    },
  );

  it(
    "supplies fallback message when error.message missing",
    () => {
      const result = formatCodexEvent({
        type: "turn.failed",
      });
      expect(strip(result!.text)).toContain(
        "no error message",
      );
    },
  );
});

describe("formatCodexEvent: agentMessage", () => {
  it("renders item.completed agent_message text", () => {
    const result = formatCodexEvent({
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "msg-1",
        text: "All done",
      },
    });
    expect(result?.isDetail).toBe(false);
    expect(result!.text).toBe("All done\n");
  });

  it("drops item.started for agent_message", () => {
    expect(
      formatCodexEvent({
        type: "item.started",
        item: { type: "agent_message", id: "msg-1" },
      }),
    ).toBeNull();
  });

  it("renders agent_message delta as raw text", () => {
    const result = formatCodexEvent({
      type: "item.delta",
      item: { type: "agent_message" },
      text: "streaming...",
    });
    expect(result?.isDetail).toBe(false);
    expect(result!.text).toBe("streaming...");
  });

  it("drops empty agent_message completion", () => {
    expect(
      formatCodexEvent({
        type: "item.completed",
        item: {
          type: "agent_message",
          id: "msg-1",
          text: "",
        },
      }),
    ).toBeNull();
  });
});

describe("formatCodexEvent: commandExecution", () => {
  it("renders item.started with command", () => {
    const result = formatCodexEvent({
      type: "item.started",
      item: {
        type: "command_execution",
        id: "call-1",
        command: "ls -la",
      },
    });
    expect(result?.isDetail).toBe(true);
    expect(strip(result!.text)).toBe("▶ ls -la\n");
  });

  it("renders item.completed output dimmed", () => {
    const result = formatCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        id: "call-1",
        command: "echo hi",
        aggregated_output: "hi\n",
        status: "completed",
      },
    });
    expect(strip(result!.text)).toContain("hi");
  });

  it(
    "surfaces non-completed status visibly",
    () => {
      const result = formatCodexEvent({
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "call-1",
          command: "false",
          aggregated_output: "",
          status: "failed",
        },
      });
      expect(strip(result!.text)).toContain(
        "[failed]",
      );
    },
  );

  it("renders output deltas with text", () => {
    const result = formatCodexEvent({
      type: "item.delta",
      item: { type: "command_execution" },
      text: "hello\n",
    });
    expect(strip(result!.text)).toBe("hello\n");
  });

  it("clips long commands", () => {
    const result = formatCodexEvent({
      type: "item.started",
      item: {
        type: "command_execution",
        id: "c",
        command: "x".repeat(500),
      },
    });
    expect(result!.text.length).toBeLessThan(300);
    expect(strip(result!.text)).toContain("...");
  });
});

describe("formatCodexEvent: reasoning", () => {
  it("renders reasoning text dimmed/styled", () => {
    const result = formatCodexEvent({
      type: "item.completed",
      item: { type: "reasoning", text: "thinking" },
    });
    expect(result?.isDetail).toBe(true);
    expect(strip(result!.text)).toBe("thinking\n");
  });

  it("drops empty reasoning", () => {
    expect(
      formatCodexEvent({
        type: "item.completed",
        item: { type: "reasoning", text: "" },
      }),
    ).toBeNull();
  });
});

describe("formatCodexEvent: terminalInteraction", () => {
  it("renders concise diagnostic line", () => {
    const result = formatCodexEvent({
      type: "command_execution.terminal_interaction",
      item: {
        type: "command_execution", id: "call-1",
      },
      processId: "12345",
      stdin: "y\n",
    });
    const txt = strip(result!.text);
    expect(txt).toContain("terminal interaction");
    expect(txt).toContain("id=call-1");
    expect(txt).toContain("pid=12345");
    expect(txt).toContain('stdin="y\\n"');
  });

  it("marks empty stdin clearly", () => {
    const result = formatCodexEvent({
      type: "command_execution.terminal_interaction",
      item: { type: "command_execution", id: "c" },
      processId: "1",
      stdin: "",
    });
    expect(strip(result!.text)).toContain(
      "stdin=(empty)",
    );
  });
});

describe("formatCodexEvent: unrecognized", () => {
  it("returns null for non-codex events", () => {
    expect(
      formatCodexEvent({ type: "assistant" }),
    ).toBeNull();
    expect(
      formatCodexEvent({ type: "stream_event" }),
    ).toBeNull();
    expect(formatCodexEvent({})).toBeNull();
  });

  it("returns null for unknown item types", () => {
    expect(
      formatCodexEvent({
        type: "item.completed",
        item: { type: "unknown_thing" },
      }),
    ).toBeNull();
  });
});
