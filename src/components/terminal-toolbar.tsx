"use client";

import {
  Copy, Square, Maximize2, Minimize2, X, Sun, Moon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type {
  Terminal as XtermTerminal,
} from "@xterm/xterm";

const BTN =
  "rounded p-1 text-white/60"
  + " hover:bg-white/10 hover:text-white";

const BTN_DARK =
  "rounded p-1 text-ink-700"
  + " hover:bg-paper-200 hover:text-ink-900";

interface TerminalToolbarProps {
  termRef: React.RefObject<
    XtermTerminal | null
  >;
  isRunning: boolean;
  isMaximized: boolean;
  thinkingDetailVisible: boolean;
  setThinkingDetailVisible: (v: boolean) => void;
  lightTheme: boolean;
  onLightThemeChange: (value: boolean) => void;
  onAbort: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function TerminalToolbar(
  props: TerminalToolbarProps,
) {
  const {
    termRef, isRunning, isMaximized,
    thinkingDetailVisible,
    setThinkingDetailVisible,
    lightTheme, onLightThemeChange,
    onAbort, onToggleMaximize, onClose,
  } = props;
  const btnClass = lightTheme ? BTN_DARK : BTN;
  const textClass = lightTheme
    ? "text-[11px] text-ink-700"
    : "text-[11px] text-white/50";
  const switchClass = lightTheme
    ? "data-[state=checked]:bg-feature-400 data-[state=unchecked]:bg-paper-300"
    : "data-[state=checked]:bg-molecule-700 data-[state=unchecked]:bg-white/20";

  return (
    <div className="flex items-center gap-1">
      <label className={
        "inline-flex items-center gap-1.5 px-1"
      }>
        <span className={textClass}>
          Detail
        </span>
        <Switch
          checked={thinkingDetailVisible}
          onCheckedChange={setThinkingDetailVisible}
          className={switchClass}
        />
      </label>
      <label className="inline-flex items-center gap-1.5 px-1">
        {lightTheme
          ? <Sun className="size-3.5 text-feature-400" />
          : <Moon className="size-3.5 text-ink-500" />}
        <span className={textClass}>
          Light Theme
        </span>
        <Switch
          checked={lightTheme}
          onCheckedChange={onLightThemeChange}
          aria-label="Light Theme"
          className={switchClass}
        />
      </label>
      <button
        type="button"
        className={btnClass}
        title="Copy output"
        onClick={() => copyTerminal(termRef)}
      >
        <Copy className="size-3.5" />
      </button>
      {isRunning && (
        <button
          type="button"
          className={
            "rounded bg-rust-500 p-1 text-white"
            + " hover:bg-rust-500"
          }
          title="Terminate"
          onClick={onAbort}
        >
          <Square className="size-3.5" />
        </button>
      )}
      <button
        type="button" className={btnClass}
        title={isMaximized ? "Restore" : "Maximize"}
        onClick={onToggleMaximize}
      >
        {isMaximized
          ? <Minimize2 className="size-3.5" />
          : <Maximize2 className="size-3.5" />}
      </button>
      <button
        type="button" className={btnClass}
        title="Close" onClick={onClose}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function copyTerminal(
  termRef: React.RefObject<XtermTerminal | null>,
) {
  const term = termRef.current;
  if (!term) return;
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i <= buf.length - 1; i++) {
    const line = buf.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  while (
    lines.length > 0
    && lines[lines.length - 1].trim() === ""
  ) {
    lines.pop();
  }
  void navigator.clipboard.writeText(lines.join("\n"));
  toast.success("Copied terminal output");
}
