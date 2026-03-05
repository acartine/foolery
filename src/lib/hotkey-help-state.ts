export const HOTKEY_HELP_KEY = "foolery-hotkey-help";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

type KeyEventLike = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">;
type RepoCycleKeyEventLike = Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "metaKey" | "ctrlKey">;
type RepoPath = string;

export type RepoCycleDirection = "forward" | "backward";

export function readHotkeyHelpOpen(storage: StorageReader | null): boolean {
  if (!storage) return true;
  const stored = storage.getItem(HOTKEY_HELP_KEY);
  if (stored === null) return true;
  return stored !== "false";
}

export function toggleHotkeyHelpOpen(previous: boolean, storage: StorageWriter | null): boolean {
  const next = !previous;
  storage?.setItem(HOTKEY_HELP_KEY, String(next));
  return next;
}

export function isHotkeyHelpToggleKey(event: KeyEventLike): boolean {
  return event.key.toLowerCase() === "h" && event.shiftKey && !event.metaKey && !event.ctrlKey;
}

export function getRepoCycleDirection(event: RepoCycleKeyEventLike): RepoCycleDirection | null {
  if (!event.shiftKey) return null;
  if (event.code !== "KeyR" && event.key.toLowerCase() !== "r") return null;
  return event.metaKey || event.ctrlKey ? "backward" : "forward";
}

export function cycleRepoPath(
  repos: RepoPath[],
  activeRepo: RepoPath | null,
  direction: RepoCycleDirection,
): RepoPath | null {
  if (repos.length === 0) return null;
  const currentIdx = activeRepo ? repos.indexOf(activeRepo) : -1;
  if (currentIdx === -1) {
    return direction === "forward" ? repos[0] : repos[repos.length - 1];
  }
  if (direction === "forward") {
    return repos[(currentIdx + 1) % repos.length];
  }
  return repos[(currentIdx - 1 + repos.length) % repos.length];
}
