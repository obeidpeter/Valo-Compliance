import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseChromium, chromiumLaunchPath, REPLIT_CHROMIUM } from "./chromium";

test("Chromium launches from the configured path, else Replit's, else Playwright's own", () => {
  const nowhere = () => false,
    replit = (path: string) => path === REPLIT_CHROMIUM;
  assert.deepEqual(chooseChromium("/opt/browsers/chrome", nowhere), {
    executablePath: "/opt/browsers/chrome",
  });
  assert.deepEqual(chooseChromium("/opt/browsers/chrome", replit), {
    executablePath: "/opt/browsers/chrome",
  });
  assert.deepEqual(chooseChromium(undefined, replit), { executablePath: REPLIT_CHROMIUM });
  assert.deepEqual(chooseChromium("", replit), { executablePath: REPLIT_CHROMIUM });
  assert.deepEqual(chooseChromium(undefined, nowhere), {});
});

test("the launch path reads CHROMIUM_EXECUTABLE_PATH from this machine's environment", () => {
  const before = process.env.CHROMIUM_EXECUTABLE_PATH;
  try {
    process.env.CHROMIUM_EXECUTABLE_PATH = "/configured/for/this/test/chrome";
    assert.deepEqual(chromiumLaunchPath(), { executablePath: "/configured/for/this/test/chrome" });
    // Unset, it is Replit's Chromium where that exists and Playwright's own everywhere else.
    delete process.env.CHROMIUM_EXECUTABLE_PATH;
    const unset = chromiumLaunchPath();
    assert.ok(unset.executablePath === undefined || unset.executablePath === REPLIT_CHROMIUM);
  } finally {
    if (before === undefined) delete process.env.CHROMIUM_EXECUTABLE_PATH;
    else process.env.CHROMIUM_EXECUTABLE_PATH = before;
  }
});
