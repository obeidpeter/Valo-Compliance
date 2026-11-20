import { test } from "node:test";
import assert from "node:assert/strict";
import { chromiumLaunchPath, REPLIT_CHROMIUM } from "./chromium";

test("Chromium launches from the configured path, else Replit's, else Playwright's own", () => {
  const nowhere = () => false,
    replit = (path: string) => path === REPLIT_CHROMIUM;
  assert.deepEqual(chromiumLaunchPath("/opt/browsers/chrome", nowhere), {
    executablePath: "/opt/browsers/chrome",
  });
  assert.deepEqual(chromiumLaunchPath("/opt/browsers/chrome", replit), {
    executablePath: "/opt/browsers/chrome",
  });
  assert.deepEqual(chromiumLaunchPath(undefined, replit), { executablePath: REPLIT_CHROMIUM });
  assert.deepEqual(chromiumLaunchPath("", replit), { executablePath: REPLIT_CHROMIUM });
  assert.deepEqual(chromiumLaunchPath(undefined, nowhere), {});
});
