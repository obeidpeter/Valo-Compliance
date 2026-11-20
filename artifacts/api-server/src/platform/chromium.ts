import { existsSync } from "node:fs";
import { setting } from "./settings";

/** Replit's system Chromium, where the development and deployed environments have it. */
export const REPLIT_CHROMIUM = "/repl/tools/bin/chromium";

/**
 * Where to launch Chromium from, to spread into Playwright's launch options:
 * `CHROMIUM_EXECUTABLE_PATH` when it is set (CI and the container image set it), else Replit's
 * system Chromium when it exists, else nothing, so Playwright launches the browser it installed
 * itself (`pnpm --filter @workspace/api-server exec playwright install chromium`).
 */
export function chromiumLaunchPath(
  configured = setting("CHROMIUM_EXECUTABLE_PATH"),
  exists: (path: string) => boolean = existsSync,
): { executablePath?: string } {
  if (configured) return { executablePath: configured };
  return exists(REPLIT_CHROMIUM) ? { executablePath: REPLIT_CHROMIUM } : {};
}
