export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "valo-theme-v1";
export const THEME_CHANGE_EVENT = "valo-theme-change";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;
type ClassTarget = { classList: { toggle(token: string, force?: boolean): boolean } };

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Restricted or disabled browser storage falls back to the default light theme.
    return null;
  }
}

/** Reads the saved appearance preference, defaulting strictly to light when unset or unreadable. */
export function readStoredTheme(storage?: ReadableStorage | null): ThemeMode {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return "light";
  try {
    return target.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    // Private browsing or blocked storage keeps the light theme without failing render.
    return "light";
  }
}

/** Persists the chosen appearance preference locally in the browser, ignoring storage restrictions. */
export function writeStoredTheme(mode: ThemeMode, storage?: WritableStorage | null): void {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return;
  try {
    target.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Quota or storage-denied browsers still apply the theme for the current page session.
  }
}

/** Applies or removes the `.dark` root class that activates dark-mode CSS tokens. */
export function applyThemeClass(mode: ThemeMode, root?: ClassTarget | null): void {
  const target =
    root === undefined ? (typeof document !== "undefined" ? document.documentElement : null) : root;
  if (!target) return;
  target.classList.toggle("dark", mode === "dark");
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}
