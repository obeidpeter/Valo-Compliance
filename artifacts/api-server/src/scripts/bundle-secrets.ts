// Checks that nothing the web app sends to browsers holds a secret (SEC-002, OPS-004): every file in
// the build's static folder and in the public folder, against the value of every secret setting set
// here and against the shapes of secrets. Run after the web app's build:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/bundle-secrets.ts ../valo
// It first plants a synthetic secret in a scratch copy of the folders and must find it, so a check
// that has stopped seeing anything fails instead of passing. A finding names the file and the setting
// or the shape, never the secret.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanBrowserFiles } from "../lib/bundle-secrets";

function canary() {
  const root = mkdtempSync(join(tmpdir(), "valo-bundle-canary-"));
  try {
    mkdirSync(join(root, ".next/static/chunks"), { recursive: true });
    const planted = `synthetic-canary-${randomBytes(16).toString("hex")}`;
    writeFileSync(
      join(root, ".next/static/chunks/canary.js"),
      `var key="sk_test_${randomBytes(16).toString("hex")}",session=${JSON.stringify(planted)};`,
    );
    const { findings } = scanBrowserFiles(root, { SESSION_SECRET: planted });
    const what = new Set(findings.map((finding) => finding.what));
    if (!what.has("the value of SESSION_SECRET") || !what.has("a payment or identity provider's secret key"))
      throw Error("BUNDLE_SECRET_CANARY_NOT_FOUND");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const webRoot = resolve(process.argv[2] ?? "../valo");
  canary();
  const { files, built, findings } = scanBrowserFiles(webRoot, process.env);
  // Without the build's own files the check would pass on the public folder alone.
  if (built === 0) throw Error("WEB_BUILD_MISSING");
  console.log(JSON.stringify({ event: "bundle-secrets", files, findings }));
  if (findings.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
