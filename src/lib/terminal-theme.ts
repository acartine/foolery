import type { ITheme } from "@xterm/xterm";

export const DARK_TERMINAL_THEME: ITheme = {
  background: "#1a1a2e",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  red: "#ff6b6b",
  green: "#51cf66",
  yellow: "#ffd43b",
  blue: "#74c0fc",
};

export const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#fafafa",
  foreground: "#1a1a2e",
  cursor: "#1a1a2e",
  red: "#d73a49",
  green: "#22863a",
  yellow: "#b08800",
  blue: "#0366d6",
};

export function getTerminalTheme(lightTheme: boolean): ITheme {
  return lightTheme ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}
