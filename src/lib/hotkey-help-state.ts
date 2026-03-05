export const HOTKEY_HELP_KEY = "foolery-hotkey-help";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

type KeyEventLike = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">;

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
