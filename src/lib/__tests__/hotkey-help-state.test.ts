import { describe, expect, it, vi } from "vitest";

import {
  HOTKEY_HELP_KEY,
  isHotkeyHelpToggleKey,
  readHotkeyHelpOpen,
  toggleHotkeyHelpOpen,
} from "@/lib/hotkey-help-state";

describe("readHotkeyHelpOpen", () => {
  it("defaults to open when storage is unavailable", () => {
    expect(readHotkeyHelpOpen(null)).toBe(true);
  });

  it("returns false when persisted as false", () => {
    expect(readHotkeyHelpOpen({ getItem: () => "false" })).toBe(false);
  });
});

describe("toggleHotkeyHelpOpen", () => {
  it("flips state and persists", () => {
    const setItem = vi.fn();
    expect(toggleHotkeyHelpOpen(true, { setItem })).toBe(false);
    expect(setItem).toHaveBeenCalledWith(HOTKEY_HELP_KEY, "false");
  });
});

describe("isHotkeyHelpToggleKey", () => {
  it("matches shift+h without ctrl/meta", () => {
    expect(
      isHotkeyHelpToggleKey({
        key: "H",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(true);
  });

  it("ignores modified or non-h keys", () => {
    expect(
      isHotkeyHelpToggleKey({
        key: "h",
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
      })
    ).toBe(false);

    expect(
      isHotkeyHelpToggleKey({
        key: "x",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(false);
  });
});
