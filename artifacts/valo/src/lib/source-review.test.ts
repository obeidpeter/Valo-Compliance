import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountableLine,
  askedMessage,
  closedLine,
  heldLine,
  noteLine,
  openerLine,
  preparationLine,
  preparing,
  reasonsLine,
} from "./source-review";

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

// ADM-003 and CMP-007 (docs/architecture/source-register.md, slice 4): where a request to prepare a
// candidate from review work stands, on a Lagos clock.
test("a preparation says whether the worker has it, what came of it, and that the candidate's reviews wait for the owner's allocation", () => {
  const asked = {
    requestedBy: "synthetic-editor",
    requestedAt: "2026-11-25T08:00:00Z",
    completedAt: null,
    candidateVersion: null,
    reasons: [],
  };
  const done = { ...asked, completedAt: "2026-11-25T09:30:00Z", candidateVersion: 3 };
  assert.equal(
    preparationLine({ ...asked, status: "pending" }),
    "A new candidate waits for the worker, asked by synthetic-editor on 25 Nov 2026, 09:00.",
  );
  assert.equal(
    preparationLine({ ...asked, status: "running" }),
    "A new candidate is being prepared, asked by synthetic-editor on 25 Nov 2026, 09:00.",
  );
  assert.equal(
    preparationLine({ ...done, status: "prepared" }),
    'Version 3 was prepared on 25 Nov 2026, 10:30. It waits for its two reviews, under "Templates and guides awaiting their reviews"; they run only under an AI allocation the owner approves.',
  );
  assert.equal(
    preparationLine({ ...done, status: "held" }),
    "Version 3 failed a check on 25 Nov 2026, 10:30 and was saved as held.",
  );
  assert.equal(
    preparationLine({ ...done, status: "not_ready" }),
    "Version 3 was not ready on 25 Nov 2026, 10:30, so nothing was kept.",
  );
  assert.equal(
    preparationLine({ ...done, candidateVersion: null, status: "failed" }),
    "The preparation stopped on 25 Nov 2026, 10:30, so nothing was kept.",
  );
  assert.equal(
    preparationLine({ ...done, candidateVersion: null, status: "closed" }),
    "The review work closed before a candidate was prepared.",
  );
  assert.equal(preparing({ ...asked, status: "pending" }), true);
  assert.equal(preparing({ ...asked, status: "running" }), true);
  assert.equal(preparing({ ...done, status: "prepared" }), false);
  assert.equal(preparing(null), false);
  assert.equal(
    reasonsLine(["PROVIDER_TERMS_SENTENCE_MISSING", "missing_evidence:GUD-03-C2"]),
    "What the checks named: PROVIDER_TERMS_SENTENCE_MISSING, missing_evidence:GUD-03-C2.",
  );
  assert.equal(reasonsLine([]), "");
  assert.equal(
    askedMessage({ targetKey: "TPL-10", targetVersion: 1 }),
    "Asked for a new candidate of TPL-10, after version 1. The worker prepares it next.",
  );
});
