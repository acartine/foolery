import type { ITheme } from "@xterm/xterm";

// Earth-tone xterm theme per MIGRATION.md §3.2.
// Hex values approximate the oklch design tokens (xterm's color parser
// doesn't accept oklch directly); source tokens are in globals.css @theme.

export const DARK_TERMINAL_THEME: ITheme = {
  background: "#2a251f",      // ink-900
  foreground: "#ede9de",      // paper-200
  cursor: "#d48a5e",          // clay-400
  cursorAccent: "#2a251f",    // ink-900
  selectionBackground: "rgba(184, 88, 42, 0.35)", // clay-500 @ 35%
  // Normal ANSI
  black: "#2a251f",           // ink-900
  red: "#b54024",             // rust-500
  green: "#7a8b4e",           // moss-500
  yellow: "#c08827",          // ochre-500
  blue: "#4a7d8a",            // lake-500
  magenta: "#b8582a",         // clay-500
  cyan: "#709aa9",            // lake-400
  white: "#f4eddc",           // paper-100
  // Bright ANSI
  brightBlack: "#5d524a",     // ink-700
  brightRed: "#d6543e",       // rust-400
  brightGreen: "#8ea560",     // moss-400
  brightYellow: "#dc9f3c",    // ochre-400
  brightBlue: "#709aa9",      // lake-400
  brightMagenta: "#d48a5e",   // clay-400
  brightCyan: "#a6c4cb",      // lake-100-ish
  brightWhite: "#faf5e9",     // paper-50
};

// Light terminal variant keeps the earth-tone palette but inverts
// background/foreground so the terminal remains legible when the user
// opts into a paper-surfaced terminal.
export const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#f4eddc",      // paper-100
  foreground: "#2a251f",      // ink-900
  cursor: "#b8582a",          // clay-500
  cursorAccent: "#f4eddc",    // paper-100
  selectionBackground: "rgba(184, 88, 42, 0.25)",
  black: "#2a251f",
  red: "#b54024",
  green: "#7a8b4e",
  yellow: "#c08827",
  blue: "#4a7d8a",
  magenta: "#b8582a",
  cyan: "#709aa9",
  white: "#ede9de",
  brightBlack: "#5d524a",
  brightRed: "#d6543e",
  brightGreen: "#8ea560",
  brightYellow: "#dc9f3c",
  brightBlue: "#709aa9",
  brightMagenta: "#d48a5e",
  brightCyan: "#a6c4cb",
  brightWhite: "#faf5e9",
};

export function getTerminalTheme(lightTheme: boolean): ITheme {
  return lightTheme ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}
