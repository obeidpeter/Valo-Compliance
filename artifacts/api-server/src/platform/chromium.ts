import { existsSync } from "node:fs";
import { setting } from "./settings";

/** Replit's system Chromium, where the development and deployed environments have it. */
export const REPLIT_CHROMIUM = "/repl/tools/bin/chromium";

/**
 * Which Chromium to launch, given the configured path and what exists on this machine: the
 * configured path when there is one, else Replit's system Chromium when it exists, else none, so
 * Playwright launches the browser it installed itself.
 */
export function chooseChromium(
  configured: string | undefined,
  exists: (path: string) => boolean,
): { executablePath?: string } {
  if (configured) return { executablePath: configured };
  return exists(REPLIT_CHROMIUM) ? { executablePath: REPLIT_CHROMIUM } : {};
}

/**
 * Where to launch Chromium from on this machine, to spread into Playwright's launch options.
 * `CHROMIUM_EXECUTABLE_PATH` is the configured path; CI and the container image set it. Without it
 * and outside Replit, install Playwright's browser first:
 * `pnpm --filter @workspace/api-server exec playwright install chromium`.
 */
export const chromiumLaunchPath = () => chooseChromium(setting("CHROMIUM_EXECUTABLE_PATH"), existsSync);
