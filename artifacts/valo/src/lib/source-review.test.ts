import { test } from "node:test";
import assert from "node:assert/strict";
import { accountableLine, closedLine, heldLine, noteLine, openerLine } from "./source-review";

// ADM-008 and CMP-007 (docs/architecture/source-register.md, slice 3): the words for review work with its
// owner, on a Lagos clock.
test("review work says what it holds since when, what opened it, who is accountable, what was checked and how it closed", () => {
  assert.equal(
    heldLine({
      targetKind: "rule",
      targetKey: "RULE-1",
      targetVersion: 2,
      createdAt: "2026-11-25T08:00:00Z",
    }),
    "Rule RULE-1, version 2 · held since 25 Nov 2026, 09:00",
  );
  assert.equal(
    heldLine({
      targetKind: "content",
      targetKey: "TPL-16",
      targetVersion: 3,
      createdAt: "2026-11-25T08:00:00Z",
    }),
    "Template or guide TPL-16, version 3 · held since 25 Nov 2026, 09:00",
  );
  assert.equal(openerLine("daily_check", "S04"), "Opened by the daily check of S04");
  assert.equal(openerLine("check_overdue", "S04"), "Opened because the daily check of S04 is overdue");
  assert.equal(openerLine("source_retired", "REG-001"), "Opened when REG-001 was retired from the register");
  assert.equal(openerLine("staff", null), "Opened by a staff hold");
  assert.equal(openerLine("review_due", null), "Opened when its review date passed");
  assert.equal(openerLine("other", null), "Opened by a hold");
  assert.equal(accountableLine("owner"), "Accountable: the development owner");
  assert.equal(accountableLine("content"), "Accountable: a Content editor");
  assert.equal(
    noteLine({
      note: "Synthetic: read the new section.",
      recordedBy: "synthetic-editor",
      createdAt: "2026-11-25T08:00:00Z",
    }),
    "25 Nov 2026, 09:00, synthetic-editor: Synthetic: read the new section.",
  );
  assert.equal(
    closedLine({
      targetKey: "RULE-1",
      targetVersion: 1,
      outcome: "superseded",
      completedAt: "2026-11-25T08:00:00Z",
    }),
    "RULE-1, version 1: closed, replaced by a later release 25 Nov 2026, 09:00",
  );
  assert.equal(
    closedLine({ targetKey: "TPL-16", targetVersion: 2, outcome: "withdrawn", completedAt: null }),
    "TPL-16, version 2: closed, withdrawn",
  );
});
