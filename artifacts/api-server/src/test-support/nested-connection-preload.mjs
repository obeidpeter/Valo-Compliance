// Loaded in every process of the CI database job once its step sets VALO_NESTED_PRELOAD (the job's
// NODE_OPTIONS imports it then; the runner refuses NODE_OPTIONS written to $GITHUB_ENV). In every
// process that loads @workspace/db, it records pooled connections taken inside a transaction and
// writes them to VALO_NESTED_REPORT_DIR on exit. nested-connection-report.mjs checks them.
import { register } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardNestedConnections } from "./nested-connection-guard-core.mjs";

const directory = process.env.VALO_NESTED_REPORT_DIR;
if (directory) {
  let guard;
  globalThis.__valoNestedConnectionGuard = (database) => {
    guard = guardNestedConnections(database);
  };
  register(new URL("./nested-connection-hooks.mjs", import.meta.url));
  process.on("exit", () => {
    // Every process that loaded the database leaves a file, even with nothing recorded, so the
    // report can tell a quiet run from one where this preload never loaded.
    if (!guard) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `${process.pid}-${Date.now()}.json`),
      JSON.stringify({ argv: process.argv.slice(1, 4), records: guard.records }),
    );
  });
}
