import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../", import.meta.url);
test("engineering context retains seven exact source blocks without inventing formal requirements or approvals", async () => {
  const register = JSON.parse(
    await readFile(new URL("docs/registers/engineering-context.json", root), "utf8"),
  );
  const source = await readFile(new URL(register.sourcePath, root), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), register.sourceSha256);
  assert.deepEqual(
    register.sections.map((row: { id: string }) => row.id),
    ["CTX-15", "CTX-16", "CTX-17", "CTX-18", "CTX-19", "CTX-24", "CTX-25"],
  );
  for (const row of register.sections) {
    assert.ok(source.includes(row.exactContract));
    assert.equal(createHash("sha256").update(row.exactContract).digest("hex"), row.sha256);
    assert.equal(row.status, "specification_recorded_not_accepted");
  }
  assert.deepEqual(
    register.ownerDecisions.map((d: { id: string }) => d.id),
    ["D01", "D02", "D03", "D04", "D05", "D06", "D07"],
  );
  assert.ok(
    register.ownerDecisions.every((d: { status: string }) => d.status === "no_gate_approval_recorded"),
  );
});
