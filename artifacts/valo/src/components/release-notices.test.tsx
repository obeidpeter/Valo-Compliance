import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseNotices } from "./release-notices";

const source = fileURLToPath(new URL("..", import.meta.url));

// EDP-008 names this text exactly. The API returns it with every released template (`disclosure` in
// @workspace/valo-core); it is written out here because the web app's typecheck does not cover that
// package.
const disclosure = "AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist";

test("a template's detail page shows its source-check and review dates, the AI-review disclosure, scope and limitations", () => {
  const notices = {
    reviewedAt: "2026-11-02",
    reviewBy: "2027-02-02",
    disclosure,
    scope: "Synthetic scope: a business draft for one private company.",
    limitations: "Synthetic limitation: does not cover regulated sectors.",
  };
  const html = renderToStaticMarkup(React.createElement(ReleaseNotices, notices));
  assert.ok(html.includes(`data-testid="text-disclosure">${disclosure}</p>`), html);
  assert.ok(html.includes(`data-testid="text-scope">${notices.scope}</p>`), html);
  assert.ok(html.includes(`data-testid="text-limitations">${notices.limitations}</p>`), html);
  assert.ok(
    html.includes(`Sources checked</dt><dd class="mt-1" data-testid="text-reviewed">2 November 2026</dd>`),
    html,
  );
  assert.ok(html.includes(`data-testid="text-review-by">2 February 2027</dd>`), html);
  // The detail page passes each released template's own notices to this component.
  const page = readFileSync(join(source, "screens/template-detail.tsx"), "utf8");
  for (const field of ["reviewedAt", "reviewBy", "disclosure", "scope", "limitations"])
    assert.match(page, new RegExp(`<ReleaseNotices[^>]*\\b${field}=\\{t\\.${field}\\}`), field);
});

test("the web app never claims lawyer approval, professional verification or guaranteed compliance", () => {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(source);
  walk(fileURLToPath(new URL("../../app", import.meta.url)));
  assert.ok(files.length > 50, "the web app's source was read");
  const claim =
    /lawyer[- ]approved|approved by (a )?lawyer|legally (approved|verified|certified)|professionally (verified|reviewed|approved)|guaranteed?[- ]complian|compliance guaranteed|certified compliant/gi;
  // Saying what was not done is the point of the notices, so a sentence that denies the claim passes.
  const denial = /\b(not|no|never|nor|without|isn't|aren't|doesn't|don't|cannot)\b/i;
  const claims: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(claim)) {
      const before = text.slice(0, match.index);
      const start = Math.max(...[". ", ".\n", ">", "{", "}", '"', "`"].map((end) => before.lastIndexOf(end)));
      const rest = text.slice(match.index);
      const end = Math.min(
        ...[".", "<", "{", "}", '"', "`"].map((e) => rest.indexOf(e)).filter((i) => i >= 0),
      );
      const sentence = text
        .slice(start + 1, match.index + end)
        .replace(/\s+/g, " ")
        .trim();
      if (!denial.test(sentence)) claims.push(`${file.slice(source.length)}: ${sentence}`);
    }
  }
  assert.deepEqual(claims, []);
});
