"use client";

interface HotkeySection {
  title: string;
  hotkeys: { key: string; description: string }[];
}

const HOTKEY_SECTIONS: HotkeySection[] = [
  {
    title: "Navigation",
    hotkeys: [
      { key: "↑ / ↓", description: "Navigate rows" },
      { key: "Shift+]", description: "Next view" },
      { key: "Shift+[", description: "Previous view" },
      { key: "Shift+R", description: "Next repository" },
      { key: "⌘+Shift+R", description: "Previous repository" },
    ],
  },
  {
    title: "Actions",
    hotkeys: [
      { key: "Shift+S", description: "Take! focused beat" },
      { key: "Shift+V", description: "Verify (close) focused beat" },
      { key: "Shift+C", description: "Close focused beat" },
      { key: "Shift+F", description: "Reject focused beat" },
    ],
  },
  {
    title: "Editing",
    hotkeys: [
      { key: "Shift+O", description: "Notes for focused beat" },
      { key: "Shift+L", description: "Add label to focused beat" },
      { key: "Shift+N", description: "Create new beat" },
    ],
  },
  {
    title: "Panels",
    hotkeys: [
      { key: "Shift+T", description: "Toggle terminal panel" },
      { key: "Shift+H", description: "Toggle this help" },
    ],
  },
];

export function HotkeyHelp({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border bg-background shadow-lg p-4">
      <h3 className="font-semibold text-sm mb-2">Keyboard Shortcuts</h3>
      <div className="space-y-3">
        {HOTKEY_SECTIONS.map((section) => (
          <div key={section.title}>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {section.title}
            </h4>
            <div className="space-y-1.5 text-xs">
              {section.hotkeys.map((h) => (
                <div key={h.key} className="flex justify-between">
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {h.key}
                  </kbd>
                  <span className="text-muted-foreground">{h.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
