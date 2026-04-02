import {
  describe,
  expect,
  it,
} from "vitest";
import {
  getTerminalViewportInset,
  MINIMIZED_TERMINAL_BAR_HEIGHT_PX,
} from "@/lib/terminal-viewport";

describe("terminal viewport inset", () => {
  it("reserves the active terminal height when the panel is open", () => {
    expect(getTerminalViewportInset({
      panelOpen: true,
      panelMinimized: false,
      panelHeight: 42,
      terminalCount: 1,
    })).toBe("42vh");
  });

  it("reserves the shared minimized bar height when minimized", () => {
    expect(getTerminalViewportInset({
      panelOpen: false,
      panelMinimized: true,
      panelHeight: 42,
      terminalCount: 1,
    })).toBe(
      `${MINIMIZED_TERMINAL_BAR_HEIGHT_PX}px`,
    );
  });

  it("returns zero when no terminal viewport is visible", () => {
    expect(getTerminalViewportInset({
      panelOpen: false,
      panelMinimized: false,
      panelHeight: 42,
      terminalCount: 1,
    })).toBe("0px");
    expect(getTerminalViewportInset({
      panelOpen: true,
      panelMinimized: false,
      panelHeight: 42,
      terminalCount: 0,
    })).toBe("0px");
  });
});
