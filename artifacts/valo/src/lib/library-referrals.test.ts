import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryLine,
  libraryHoldExplained,
  referralLine,
  referredLine,
  targetKindNames,
} from "./library-referrals";

// ADM-008 (docs/architecture/library-holds.md, slice 3): the words for a reported problem that points at
// a staff-library entry, or at a rule the owner signed.
test("a library referral names the entry, its kind and version, and the owner's panel says whether the version was held", () => {
  assert.equal(targetKindNames.library, "Guide or template");
  assert.equal(
    entryLine({ title: "Synthetic sales agreement", kind: "premium_template", version: 2 }),
    "Synthetic sales agreement · Premium template · version 2",
  );
  assert.equal(
    referredLine({ targetKind: "library", targetTitle: "Synthetic sales agreement", targetVersion: 2 }),
    'Referred guide or template "Synthetic sales agreement", version 2',
  );
  assert.equal(
    referredLine({ targetKind: "library", targetTitle: null, targetVersion: 1 }),
    'Referred guide or template "untitled", version 1',
  );
  assert.equal(
    referredLine({ targetKind: "rule", targetTitle: null, targetVersion: 3 }),
    "Referred rule version 3",
  );
  assert.match(libraryHoldExplained, /copies none of its words/);
  assert.match(libraryHoldExplained, /customers cannot find, download or buy it/);
  // On a Lagos clock: 23:30 UTC on 25 November is 26 November in Lagos.
  assert.equal(
    referralLine({ reference: "VALO-1", version: 2, held: false, referredAt: "2026-11-25T23:30:00Z" }),
    "VALO-1, about version 2, reported 26 Nov 2026. That version is not held.",
  );
  assert.equal(
    referralLine({ reference: "VALO-1", version: 2, held: true, referredAt: "2026-11-25T09:00:00Z" }),
    "VALO-1, about version 2, reported 25 Nov 2026. Content staff held that version, so the requirements check no longer uses it.",
  );
});
