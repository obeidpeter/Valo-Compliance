import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { OTHER_PACKAGE_SETTINGS, SETTINGS, renderEnvExample } from "./settings";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const source = fileURLToPath(new URL("../", import.meta.url));
const shipped = new Set([
  "scripts/production-bootstrap.ts",
  "scripts/production-preflight.ts",
  "scripts/export-retention-inventory.ts",
  "scripts/production-storage-probe.ts",
  "scripts/monitoring-probe.ts",
  "scripts/staff-bootstrap.ts",
]);

function productFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return entry === "test-support" ? [] : productFiles(full);
    const path = relative(source, full).replaceAll("\\", "/");
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    if (path.startsWith("scripts/") && !shipped.has(path)) return [];
    return [path];
  });
}

test(".env.example is generated from the settings registry", () => {
  assert.equal(
    readFileSync(join(repository, ".env.example"), "utf8"),
    renderEnvExample(),
    ".env.example is stale: run `pnpm --filter @workspace/api-server settings:env-example`",
  );
});

test("every variable product code reads is registered and only settings reads process.env", () => {
  const registered = new Set([...Object.keys(SETTINGS), ...Object.keys(OTHER_PACKAGE_SETTINGS)]);
  const unregistered: string[] = [];
  const directReads: string[] = [];
  const files = productFiles(source);
  assert.ok(files.length > 150, "product files were actually scanned");
  for (const file of files) {
    const text = readFileSync(join(source, file), "utf8");
    if (file === "platform/settings.ts") continue; // the registry itself
    if (/process\.env\b/.test(text)) directReads.push(file);
    for (const match of text.matchAll(
      /\b(?:setting\(\s*["']|env\.|env\[\s*["'])([A-Z][A-Z0-9_]+)|["'](VALO_[A-Z0-9_]+_ENABLED)["']/g,
    )) {
      const name = match[1] ?? match[2]!;
      if (!registered.has(name) && !name.startsWith("REPLIT_DEPLOYMENT_"))
        unregistered.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(directReads, [], "read environment variables through platform/settings");
  assert.deepEqual(unregistered, [], "register these variables in platform/settings.ts");
});

test("secrets never carry example values", () => {
  for (const [name, definition] of Object.entries({ ...SETTINGS, ...OTHER_PACKAGE_SETTINGS }))
    if ("secret" in definition && definition.secret) assert.equal("example" in definition, false, name);
  assert.match(renderEnvExample(), /^SESSION_SECRET=$/m);
});
