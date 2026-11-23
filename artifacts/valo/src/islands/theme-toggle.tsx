"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyThemeClass,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Opt-in light/dark appearance switch shared by server-rendered public pages and the workspace
 * shell. Starts in light mode on first server render to avoid hydration mismatch and restores any
 * saved preference in the browser on mount.
 */
export function ThemeToggle({
  className,
  testId = "button-theme-toggle",
}: {
  className?: string;
  testId?: string;
}) {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const sync = () => {
      const stored = readStoredTheme();
      setTheme(stored);
      applyThemeClass(stored);
    };
    sync();
    const onThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<ThemeMode>).detail;
      const next: ThemeMode = detail === "dark" ? "dark" : detail === "light" ? "light" : readStoredTheme();
      setTheme(next);
      applyThemeClass(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) sync();
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function toggle() {
    const next = nextTheme(theme);
    setTheme(next);
    writeStoredTheme(next);
    applyThemeClass(next);
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: next }));
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className={cn("btn btn-ghost btn-sm", className)}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      data-testid={testId}
    >
      {isDark ? (
        <>
          <Sun className="h-4 w-4" aria-hidden="true" />
          <span>Light theme</span>
        </>
      ) : (
        <>
          <Moon className="h-4 w-4" aria-hidden="true" />
          <span>Dark theme</span>
        </>
      )}
    </button>
  );
}
