import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { extractOperationalBody, readOperationalIntake } from "./operational-intake";
test("all twelve exact operational IDs compile without examples, metadata or neighbouring forms", async () => {
  for (let i = 1; i <= 12; i++) {
    const id = `TPL-${String(i).padStart(2, "0")}`,
      r = await readOperationalIntake(id);
    assert.equal(r.section.id, id);
    assert.ok(r.document.content.blocks.length > 0);
    assert.doesNotMatch(
      r.section.body,
      /^## TPL-|Synthetic filled example|Fictional example|Guided field specification|EDP-/m,
    );
    assert.equal(r.publicationStatus, "unpublished_candidate");
    assert.equal(r.reviewState, "not_run");
  }
});
test("corrected inventory/expense bodies and complete customer subsections are selected", async () => {
  const inventory = await readOperationalIntake("TPL-07"),
    expense = await readOperationalIntake("TPL-06");
  assert.match(inventory.sourcePath, /operational-template-revisions/);
  assert.match(inventory.section.body, /Opening balance/);
  assert.match(inventory.section.body, /Physical count and reconciliation/);
  assert.doesNotMatch(inventory.section.body, /Expense claim|Publication handoff/);
  assert.match(expense.section.body, /Funding already allocated/);
  assert.match(expense.section.body, /Settlement update/);
  const invoice = await readOperationalIntake("TPL-01");
  assert.match(invoice.section.body, /Tax|tax/);
  assert.ok(invoice.document.content.blocks.length > 5);
});
test("changed bytes, duplicate IDs and unsupported IDs cannot be silently imported", () => {
  const body = "x".repeat(120);
  const source = `## TPL-01 — Invoice\n### Customer form\n${body}\n## Amounts\n${body}\n### Synthetic filled example\nDO NOT IMPORT\n## TPL-02 — Quotation\nNeighbour`;
  assert.match(extractOperationalBody("TPL-01", "Invoice", source, sha256(source)).body, /## Amounts/);
  assert.doesNotMatch(
    extractOperationalBody("TPL-01", "Invoice", source, sha256(source)).body,
    /DO NOT IMPORT|Neighbour/,
  );
  assert.throws(
    () => extractOperationalBody("TPL-01", "Invoice", source + "changed", sha256(source)),
    /HASH_MISMATCH/,
  );
  const duplicate = source + "\n## TPL-01 — Invoice\nDuplicate";
  assert.throws(
    () => extractOperationalBody("TPL-01", "Invoice", duplicate, sha256(duplicate)),
    /EXACTLY_ONE/,
  );
  assert.throws(
    () => extractOperationalBody("TPL-13", "Service agreement", source, sha256(source)),
    /NOT_SUPPORTED/,
  );
});
