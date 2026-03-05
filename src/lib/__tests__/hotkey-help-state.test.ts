import { describe, expect, it, vi } from "vitest";

import {
  cycleRepoPath,
  getRepoCycleDirection,
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

describe("getRepoCycleDirection", () => {
  it("matches shift+r in forward mode", () => {
    expect(
      getRepoCycleDirection({
        code: "KeyR",
        key: "r",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe("forward");
  });

  it("matches cmd/ctrl+shift+r in reverse mode", () => {
    expect(
      getRepoCycleDirection({
        code: "KeyR",
        key: "R",
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
      })
    ).toBe("backward");

    expect(
      getRepoCycleDirection({
        code: "KeyR",
        key: "R",
        shiftKey: true,
        metaKey: false,
        ctrlKey: true,
      })
    ).toBe("backward");
  });

  it("ignores non-shift or non-r keys", () => {
    expect(
      getRepoCycleDirection({
        code: "KeyR",
        key: "r",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBeNull();

    expect(
      getRepoCycleDirection({
        code: "KeyN",
        key: "n",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBeNull();
  });
});

describe("cycleRepoPath", () => {
  const repos = ["/repo-a", "/repo-b", "/repo-c"];

  it("cycles forward and wraps to the first repo", () => {
    expect(cycleRepoPath(repos, "/repo-a", "forward")).toBe("/repo-b");
    expect(cycleRepoPath(repos, "/repo-c", "forward")).toBe("/repo-a");
  });

  it("cycles backward and wraps to the last repo", () => {
    expect(cycleRepoPath(repos, "/repo-c", "backward")).toBe("/repo-b");
    expect(cycleRepoPath(repos, "/repo-a", "backward")).toBe("/repo-c");
  });

  it("handles unknown active repos by selecting edge repos for each direction", () => {
    expect(cycleRepoPath(repos, "/repo-z", "forward")).toBe("/repo-a");
    expect(cycleRepoPath(repos, "/repo-z", "backward")).toBe("/repo-c");
    expect(cycleRepoPath(repos, null, "forward")).toBe("/repo-a");
    expect(cycleRepoPath(repos, null, "backward")).toBe("/repo-c");
  });

  it("returns null when there are no registered repos", () => {
    expect(cycleRepoPath([], "/repo-a", "forward")).toBeNull();
  });
});
