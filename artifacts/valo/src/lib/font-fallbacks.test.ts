import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The web fonts' fallback faces in src/fonts.css (NFR-002's CLS target): each one's width and
 * vertical metrics, recomputed from the font files with the formula Next's next/font uses, and the
 * font stacks that put each fallback right after its web font.
 */
const source = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const next = join(dirname(require.resolve("next/package.json")), "dist/compiled/@next/font/dist");

type Font = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  glyphsForString(text: string): { advanceWidth: number }[];
};
type Metrics = {
  sizeAdjust: string;
  ascentOverride: string;
  descentOverride: string;
  lineGapOverride: string;
};
// The font reader next/font bundles, and its own calculation for comparison.
const reader = require(join(next, "fontkit/index.js")) as {
  default: ((bytes: Buffer) => unknown) & { default?: (bytes: Buffer) => unknown };
};
const openFont = (file: string) =>
  (reader.default.default ?? reader.default)(readFileSync(join(source, "fonts", file))) as Font;
const { getFallbackMetricsFromFontFile } = require(
  join(next, "local/get-fallback-metrics-from-font-file.js"),
) as { getFallbackMetricsFromFontFile: (font: Font, category: "serif" | "sans-serif") => Metrics };

/** The letters next/font averages a font's width over. */
const LETTERS = "aaabcdeeeefghiijklmnnoopqrrssttuvwxyz      ";
const averageWidth = (font: Font) => {
  const glyphs = font.glyphsForString(LETTERS);
  return glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / glyphs.length / font.unitsPerEm;
};
const percent = (value: number) => Math.abs(value * 100).toFixed(2) + "%";

/** next/font's formula: the size that gives the fallback the web font's average width, and the web
 * font's ascent, descent and line gap at that size. */
function fallbackMetrics(font: Font, fallbackWidth: number): Metrics {
  const sizeAdjust = averageWidth(font) / fallbackWidth;
  return {
    sizeAdjust: percent(sizeAdjust),
    ascentOverride: percent(font.ascent / (font.unitsPerEm * sizeAdjust)),
    descentOverride: percent(font.descent / (font.unitsPerEm * sizeAdjust)),
    lineGapOverride: percent(font.lineGap / (font.unitsPerEm * sizeAdjust)),
  };
}

// Arial's and Times New Roman's average widths as next/font records them, and Times New Roman
// Italic's, measured the same way on Liberation Serif Italic, which has its metrics.
const ARIAL = 934.5116279069767 / 2048;
const TIMES = 854.3953488372093 / 2048;
const TIMES_ITALIC = 846.5581395348837 / 2048;

const FACES = [
  {
    family: "Instrument Sans Fallback",
    style: "normal",
    file: "instrument-sans-latin-wght-normal.woff2",
    width: ARIAL,
    category: "sans-serif",
  },
  {
    family: "Newsreader Fallback",
    style: "normal",
    file: "newsreader-latin-opsz-normal.woff2",
    width: TIMES,
    category: "serif",
  },
  {
    family: "Newsreader Fallback",
    style: "italic",
    file: "newsreader-latin-opsz-italic.woff2",
    width: TIMES_ITALIC,
  },
] as const;

/** The declarations of the fallback face for this family and style in src/fonts.css. */
function declared(family: string, style: string): Metrics {
  const css = readFileSync(join(source, "fonts.css"), "utf8");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const face = faces.filter(
    (f) => f.includes(`font-family: "${family}";`) && f.includes(`font-style: ${style};`),
  );
  assert.equal(face.length, 1, `one ${style} ${family} face`);
  const value = (name: string) => new RegExp(`${name}: ([\\d.]+%);`).exec(face[0]!)?.[1] ?? "missing";
  return {
    sizeAdjust: value("size-adjust"),
    ascentOverride: value("ascent-override"),
    descentOverride: value("descent-override"),
    lineGapOverride: value("line-gap-override"),
  };
}

test("each web font's fallback face has the width and vertical metrics next/font's formula gives for its font file", () => {
  for (const face of FACES) {
    const font = openFont(face.file);
    const expected = fallbackMetrics(font, face.width);
    assert.deepEqual(declared(face.family, face.style), expected, `${face.style} ${face.family}`);
    // The upright faces match next/font's own calculation exactly.
    if ("category" in face) {
      const { sizeAdjust, ascentOverride, descentOverride, lineGapOverride } = getFallbackMetricsFromFontFile(
        font,
        face.category,
      );
      assert.deepEqual({ sizeAdjust, ascentOverride, descentOverride, lineGapOverride }, expected, face.file);
    }
  }
});

test("the app's font stacks put each fallback face right after its web font", () => {
  const css = readFileSync(join(source, "index.css"), "utf8");
  assert.match(css, /--app-font-sans: 'Instrument Sans', 'Instrument Sans Fallback', /);
  assert.match(css, /--app-font-serif: 'Newsreader', 'Newsreader Fallback', /);
});
