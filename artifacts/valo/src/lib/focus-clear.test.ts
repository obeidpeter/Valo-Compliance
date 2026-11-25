import assert from "node:assert/strict";
import { test } from "node:test";
import { clearance } from "./focus-clear";

// WCAG 2.2, Focus Not Obscured: an element focused on the screen but under the bars that stay there
// is scrolled into the room the page's scroll padding reserves for them.
test("a focused element under a bar that stays on screen is scrolled clear of it, and one already clear stays", () => {
  // A phone 640 pixels high, the header's 80 pixels at the top and a screen's held actions above the
  // bottom bar, 168 pixels, at the bottom.
  const view = { height: 640, paddingTop: 80, paddingBottom: 168 };
  // A field whose lower edge is under the held actions moves up by the overlap.
  assert.equal(clearance({ top: 390, bottom: 502 }, view), 30);
  // One under the header moves down.
  assert.equal(clearance({ top: 60, bottom: 100 }, view), -20);
  // One clear of both stays.
  assert.equal(clearance({ top: 200, bottom: 300 }, view), 0);
  assert.equal(clearance({ top: 80, bottom: 472 }, view), 0);
  // One too tall to fit between them stays where the browser put it.
  assert.equal(clearance({ top: 100, bottom: 600 }, view), 0);
});
