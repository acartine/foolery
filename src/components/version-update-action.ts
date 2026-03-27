"use client";

import {
  useCallback, useEffect, useRef, useState,
} from "react";

type ClipboardWriter = Pick<Clipboard, "writeText">;

export const VERSION_UPDATE_COMMAND = "foolery update";

function getClipboard(
): ClipboardWriter | null {
  return globalThis.navigator?.clipboard ?? null;
}

export async function triggerVersionUpdate(
  clipboard: ClipboardWriter | null = getClipboard(),
): Promise<boolean> {
  if (!clipboard) return false;

  try {
    await clipboard.writeText(VERSION_UPDATE_COMMAND);
    return true;
  } catch {
    return false;
  }
}

export function useVersionUpdateAction() {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  useEffect(() => () => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
  }, []);

  const triggerUpdate = useCallback(async () => {
    const ok = await triggerVersionUpdate();
    if (!ok) return false;

    setCopied(true);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return true;
  }, []);

  return { copied, triggerUpdate } as const;
}
