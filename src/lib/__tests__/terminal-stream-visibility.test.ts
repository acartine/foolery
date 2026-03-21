import { describe, expect, it, vi } from "vitest";
import type { TerminalDetailFilter } from "@/lib/terminal-detail-filter";
import { getVisibleTerminalStreamChunk } from "@/lib/terminal-stream-visibility";

function createFilterMock(output: string): TerminalDetailFilter {
  return {
    filter: vi.fn(() => output),
    reset: vi.fn(),
  };
}

describe("getVisibleTerminalStreamChunk", () => {
  it("filters stdout when thinking detail is hidden", () => {
    const filter = createFilterMock("▶ Bash ls\n");

    expect(
      getVisibleTerminalStreamChunk(filter, "▶ Bash ls\nsrc\n", {
        stream: "stdout",
        thinkingDetailVisible: false,
      }),
    ).toBe("▶ Bash ls\n");

    expect(filter.filter).toHaveBeenCalledWith("▶ Bash ls\nsrc\n");
  });

  it("hides stderr when thinking detail is hidden", () => {
    const filter = createFilterMock("unused");

    expect(
      getVisibleTerminalStreamChunk(filter, "Error: missing file\n", {
        stream: "stderr",
        thinkingDetailVisible: false,
      }),
    ).toBe("");

    expect(filter.filter).not.toHaveBeenCalled();
  });

  it("passes stdout through unchanged when thinking detail is visible", () => {
    const filter = createFilterMock("unused");

    expect(
      getVisibleTerminalStreamChunk(filter, "▶ Bash ls\nsrc\n", {
        stream: "stdout",
        thinkingDetailVisible: true,
      }),
    ).toBe("▶ Bash ls\nsrc\n");

    expect(filter.filter).not.toHaveBeenCalled();
  });

  it("colorizes stderr when thinking detail is visible", () => {
    const filter = createFilterMock("unused");

    expect(
      getVisibleTerminalStreamChunk(filter, "Error: missing file\n", {
        stream: "stderr",
        thinkingDetailVisible: true,
      }),
    ).toBe("\x1b[31mError: missing file\n\x1b[0m");

    expect(filter.filter).not.toHaveBeenCalled();
  });
});
