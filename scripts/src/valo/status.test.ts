import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderStatus, statusPath } from "./status";

test("docs/status.md matches the registers it is generated from", () => {
  assert.equal(
    readFileSync(statusPath, "utf8"),
    renderStatus(),
    "docs/status.md is stale: run `pnpm --filter @workspace/scripts valo:status`",
  );
});
