"use client";

import {
  Copy, Square, Maximize2, Minimize2, X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type {
  Terminal as XtermTerminal,
} from "@xterm/xterm";

const BTN =
  "rounded p-1 text-white/60"
  + " hover:bg-white/10 hover:text-white";

interface TerminalToolbarProps {
  termRef: React.RefObject<
    XtermTerminal | null
  >;
  isRunning: boolean;
  isMaximized: boolean;
  thinkingDetailVisible: boolean;
  setThinkingDetailVisible: (v: boolean) => void;
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
    onAbort, onToggleMaximize, onClose,
  } = props;
  return (
    <div className="flex items-center gap-1">
      <label className={
        "inline-flex items-center gap-1.5 px-1"
      }>
        <span className="text-[11px] text-white/50">
          Detail
        </span>
        <Switch
          checked={thinkingDetailVisible}
          onCheckedChange={setThinkingDetailVisible}
          className={
            "data-[state=checked]:bg-cyan-600"
            + " data-[state=unchecked]:bg-white/20"
          }
        />
      </label>
      <button
        type="button"
        className={BTN}
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
        type="button" className={BTN}
        title={isMaximized ? "Restore" : "Maximize"}
        onClick={onToggleMaximize}
      >
        {isMaximized
          ? <Minimize2 className="size-3.5" />
          : <Maximize2 className="size-3.5" />}
      </button>
      <button
        type="button" className={BTN}
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
