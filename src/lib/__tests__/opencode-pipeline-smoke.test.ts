/**
 * End-to-end smoke for the OpenCode rendering pipeline.
 *
 * Hermetic — no real network or fs. Simulates a typical
 * OpenCode SSE/message stream (server URL → reasoning →
 * tool call → tool result → assistant text → step finish)
 * and asserts the formatted terminal output the user sees
 * in the final terminal pane contains tool calls,
 * reasoning, and the assistant message — i.e. the gap
 * the knot exists to close.
 */
import { describe, it, expect } from "vitest";
import {
  translateOpenCodeResponse,
  translateOpenCodeEvent,
} from "@/lib/opencode-event-translate";
import {
  createOpenCodeNormalizer,
} from "@/lib/agent-adapter-normalizers";
import {
  formatStreamEvent,
} from "@/lib/terminal-manager-format";

function strip(text: string): string {
  return text.replace(
    new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"),
    "",
  );
}

interface InputPart {
  type: string;
  [key: string]: unknown;
}

interface Pipeline {
  feed(event: Record<string, unknown>): void;
  feedPart(part: InputPart): void;
  rendered(): string;
}

function createPipeline(): Pipeline {
  const norm = createOpenCodeNormalizer();
  const out: string[] = [];
  const consume = (event: Record<string, unknown>) => {
    const formatted = formatStreamEvent(event);
    if (formatted) out.push(formatted.text);
    const normalized = norm(event);
    if (normalized) {
      const f = formatStreamEvent(normalized);
      if (f) out.push(f.text);
    }
  };
  return {
    feed(event) {
      for (const e of translateOpenCodeEvent(event)) consume(e);
    },
    feedPart(part) {
      const events = translateOpenCodeResponse({
        parts: [part],
      });
      for (const e of events) consume(e);
    },
    rendered() {
      return strip(out.join(""));
    },
  };
}

describe("OpenCode pipeline smoke", () => {
  it("renders a complete turn with tools and reasoning", () => {
    const pipe = createPipeline();

    pipe.feedPart({ type: "step-start" });
    pipe.feedPart({
      type: "reasoning",
      text: "I should list the directory first.",
    });
    pipe.feed({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          id: "call_ls",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "ls -la /tmp" },
            output: "drwxr-xr-x  10 user  staff  320 ...\n",
          },
        },
      },
    });
    pipe.feedPart({
      type: "text",
      text: "The directory has 10 entries.",
    });
    pipe.feedPart({ type: "step-finish", reason: "stop" });

    const out = pipe.rendered();
    expect(out).toContain("I should list the directory first.");
    expect(out).toContain("▶ bash");
    expect(out).toContain("ls -la /tmp");
    expect(out).toContain("drwxr-xr-x");
    expect(out).toContain("The directory has 10 entries.");
  });

  it("renders read tool with filePath arg", () => {
    // OpenCode tools use camelCase keys (filePath) where Claude
    // uses snake_case (file_path). The renderer recognizes both
    // so OpenCode read/edit/write show the path, not just
    // "▶ read".
    const pipe = createPipeline();
    pipe.feedPart({
      type: "tool",
      id: "call_read_x",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/notes.md" },
        output: "hello",
      },
    });
    const out = pipe.rendered();
    expect(out).toContain("▶ read");
    expect(out).toContain("/tmp/notes.md");
  });

  it("renders session.error as a red banner", () => {
    const pipe = createPipeline();
    pipe.feed({
      type: "session.error",
      properties: { error: { message: "rate limited" } },
    });
    expect(pipe.rendered()).toContain("rate limited");
  });

  it("renders permission.asked for approval banner", () => {
    const pipe = createPipeline();
    pipe.feed({
      type: "permission.asked",
      sessionID: "ses_1",
      requestID: "req_1",
      tool: "Bash",
    });
    const out = pipe.rendered();
    expect(out.toLowerCase()).toContain("approval");
  });
});
