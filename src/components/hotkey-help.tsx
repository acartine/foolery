"use client";

const HOTKEYS = [
  { key: "↑ / ↓", description: "Navigate rows" },
  { key: "Shift+V", description: "Verify (close) focused bead" },
  { key: "Shift+F", description: "Reject focused bead" },
  { key: "Shift+L", description: "Add label to focused bead" },
  { key: "h", description: "Toggle this help" },
];

export function HotkeyHelp({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border bg-background shadow-lg p-4">
      <h3 className="font-semibold text-sm mb-2">Keyboard Shortcuts</h3>
      <div className="space-y-1.5 text-xs">
        {HOTKEYS.map((h) => (
          <div key={h.key} className="flex justify-between">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {h.key}
            </kbd>
            <span className="text-muted-foreground">{h.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
