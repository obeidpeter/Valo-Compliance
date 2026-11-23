import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeToggle } from "@/islands/theme-toggle";
import { THEME_STORAGE_KEY, applyThemeClass, nextTheme, readStoredTheme, writeStoredTheme } from "./theme";

test("readStoredTheme defaults strictly to light unless dark is explicitly stored", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null };

  assert.equal(readStoredTheme(null), "light");
  assert.equal(readStoredTheme(storage), "light");

  store.set(THEME_STORAGE_KEY, "system");
  assert.equal(readStoredTheme(storage), "light");

  store.set(THEME_STORAGE_KEY, "dark");
  assert.equal(readStoredTheme(storage), "dark");

  const broken = {
    getItem() {
      throw new Error("storage blocked");
    },
  };
  assert.equal(readStoredTheme(broken), "light");
});

test("writeStoredTheme saves preferences and tolerates restricted storage", () => {
  const store = new Map<string, string>();
  writeStoredTheme("dark", { setItem: (key, value) => void store.set(key, value) });
  assert.equal(store.get(THEME_STORAGE_KEY), "dark");

  assert.doesNotThrow(() =>
    writeStoredTheme("light", {
      setItem() {
        throw new Error("quota exceeded");
      },
    }),
  );
});

test("applyThemeClass toggles the dark class on the root element and nextTheme alternates cleanly", () => {
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle(token: string, force?: boolean) {
        const shouldAdd = force ?? !classes.has(token);
        if (shouldAdd) classes.add(token);
        else classes.delete(token);
        return shouldAdd;
      },
    },
  };

  applyThemeClass("dark", root);
  assert.equal(classes.has("dark"), true);

  applyThemeClass("light", root);
  assert.equal(classes.has("dark"), false);

  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
});

test("ThemeToggle renders a labeled accessible button in default light mode for SSR", () => {
  const html = renderToStaticMarkup(<ThemeToggle />);
  assert.match(html, /data-testid="button-theme-toggle"/);
  assert.match(html, /aria-label="Switch to dark theme"/);
  assert.match(html, />Dark theme</);
});
