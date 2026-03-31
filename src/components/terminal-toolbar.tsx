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
  "rounded p-1 text-slate-600"
  + " hover:bg-slate-200 hover:text-slate-900";

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
    ? "text-[11px] text-slate-500"
    : "text-[11px] text-white/50";
  const switchClass = lightTheme
    ? "data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-slate-300"
    : "data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-white/20";

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
          ? <Sun className="size-3.5 text-amber-500" />
          : <Moon className="size-3.5 text-slate-500" />}
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
            "rounded bg-red-600 p-1 text-white"
            + " hover:bg-red-500"
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
  navigator.clipboard.writeText(lines.join("\n"));
  toast.success("Copied terminal output");
}
