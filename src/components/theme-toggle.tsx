"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const ORDER: ThemeMode[] = ["light", "dark", "system"];
const STORAGE_EVENT = "foolery-theme-change";

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const dark = mode === "dark"
    || (mode === "system"
      && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function nextMode(current: ThemeMode): ThemeMode {
  const i = ORDER.indexOf(current);
  return ORDER[(i + 1) % ORDER.length]!;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(STORAGE_EVENT, cb);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(STORAGE_EVENT, cb);
    media.removeEventListener("change", cb);
  };
}

export function ThemeToggle() {
  const mode = useSyncExternalStore<ThemeMode>(
    subscribe,
    readStored,
    () => "system",
  );

  useEffect(() => { applyMode(mode); }, [mode]);

  const cycle = useCallback(() => {
    const next = nextMode(readStored());
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }, []);

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label = mode === "light" ? "Light mode"
    : mode === "dark" ? "Dark mode"
    : "System mode";

  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 shrink-0"
      title={`${label} (click to cycle)`}
      aria-label={`Theme: ${label}. Click to cycle.`}
      onClick={cycle}
    >
      <Icon className="size-4" />
    </Button>
  );
}
