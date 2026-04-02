export const MINIMIZED_TERMINAL_BAR_HEIGHT_PX = 32;

export interface TerminalViewportInsetInput {
  panelOpen: boolean;
  panelMinimized: boolean;
  panelHeight: number;
  terminalCount: number;
}

export function getTerminalViewportInset(
  input: TerminalViewportInsetInput,
): string {
  const {
    panelOpen,
    panelMinimized,
    panelHeight,
    terminalCount,
  } = input;

  if (terminalCount === 0) return "0px";
  if (panelOpen) return `${panelHeight}vh`;
  if (panelMinimized) {
    return `${MINIMIZED_TERMINAL_BAR_HEIGHT_PX}px`;
  }
  return "0px";
}
