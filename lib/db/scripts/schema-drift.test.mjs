// Fails when the Drizzle schema changed without a migration: drizzle-kit would
// generate a new one against the latest snapshot. Runs in a temporary copy, so the
// real migrations folder is never written, and needs no database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

test("the Drizzle schema matches the latest migration snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valo-schema-drift-"));
  try {
    await cp(join(packageRoot, "drizzle"), join(directory, "drizzle"), { recursive: true });
    const config = join(directory, "drizzle.config.ts");
    // drizzle-kit needs the output path relative to the package working directory.
    await writeFile(
      config,
      `import { defineConfig } from "drizzle-kit";\nexport default defineConfig(${JSON.stringify({
        schema: join(packageRoot, "src/schema/index.ts").replaceAll("\\", "/"),
        out: relative(packageRoot, join(directory, "drizzle")).replaceAll("\\", "/"),
        dialect: "postgresql",
        dbCredentials: { url: "postgresql://unused@127.0.0.1:1/unused" },
      })});\n`,
    );
    const before = (await readdir(join(directory, "drizzle"))).length;
    const isWindows = process.platform === "win32";
    const { stdout } = await promisify(execFile)(
      isWindows ? "cmd.exe" : "pnpm",
      [
        ...(isWindows ? ["/d", "/c", "pnpm.cmd"] : []),
        "exec",
        "drizzle-kit",
        "generate",
        "--config",
        config,
        "--name",
        "drift",
      ],
      { cwd: packageRoot, timeout: 120000 },
    );
    assert.match(
      stdout,
      /No schema changes/,
      "the schema changed without a migration: run drizzle-kit generate",
    );
    assert.equal((await readdir(join(directory, "drizzle"))).length, before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
