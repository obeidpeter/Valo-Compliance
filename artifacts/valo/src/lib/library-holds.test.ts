import { test } from "node:test";
import assert from "node:assert/strict";
import { heldLine, holdHint, holdLabel, liftHint, liftLabel, ownerLiftsWords } from "./library-holds";

// ADM-007 and EDP-011 (docs/architecture/library-holds.md, slice 2): the words for a hold on a published
// library entry, short of a withdrawal.
test("a held entry says since when and why, that customers cannot use it while what they have stays, and who lifts it", () => {
  // On a Lagos clock: 23:30 UTC on 25 November is 26 November in Lagos.
  assert.equal(
    heldLine(2, {
      reason: "Held while a reader's report on the payment clause is checked",
      placedAt: "2026-11-25T23:30:00Z",
      workspaces: 3,
    }),
    "Version 2 is held since 26 Nov 2026: Held while a reader's report on the payment clause is checked. Customers cannot find, download or buy it. What they already have is unchanged.",
  );
  assert.equal(
    heldLine(1, {
      reason: "  Checked again after a complaint.  ",
      placedAt: "2026-11-25T09:00:00Z",
      workspaces: 0,
    }),
    "Version 1 is held since 25 Nov 2026: Checked again after a complaint. Customers cannot find, download or buy it. What they already have is unchanged.",
  );
  assert.equal(holdLabel, "Why is this version held?");
  assert.match(holdHint, /are not told\. What they already have is unchanged\./);
  assert.equal(liftLabel, "Why is the hold lifted?");
  assert.match(liftHint, /^Customers can find, download and buy it again/);
  assert.equal(ownerLiftsWords, "Only the owner lifts a regulatory guide's hold, from the owner's panel.");
});
