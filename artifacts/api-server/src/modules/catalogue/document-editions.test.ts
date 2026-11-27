import test from "node:test";
import assert from "node:assert/strict";
import { editionStanding } from "./document-editions";

// docs/architecture/editions.md, slice 1: where the template edition behind a document stands, on
// either route.
test("a document's edition reads replaced while a later one is released, withdrawn once none is, and nothing while current", () => {
  const released = new Date("2026-11-25T09:00:00Z"),
    withdrawnAt = new Date("2026-11-26T09:00:00Z");
  const recorded = { version: 1, withdrawn: false, withdrawnAt: null, reason: null };
  const later = {
    version: 2,
    withdrawn: false,
    releasedAt: released,
    withdrawnAt: null,
    reason: null,
    href: "/library/manual-synthetic",
  };
  // Still the template's release: nothing to say.
  assert.equal(editionStanding(recorded, null), null);
  // A later edition released: replaced, with its version, date and page.
  assert.deepEqual(editionStanding(recorded, later), {
    state: "replaced",
    since: released,
    reason: null,
    current: { version: 2, href: "/library/manual-synthetic" },
  });
  // The edition itself withdrawn, with no later release: withdrawn, with its reason.
  assert.deepEqual(
    editionStanding({ ...recorded, withdrawn: true, withdrawnAt, reason: "A synthetic reason." }, null),
    { state: "withdrawn", since: withdrawnAt, reason: "A synthetic reason.", current: null },
  );
  // Withdrawn, then replaced: the later release is what the customer can take.
  assert.equal(
    editionStanding({ ...recorded, withdrawn: true, withdrawnAt, reason: null }, later)?.state,
    "replaced",
  );
  // Replaced, then the later edition withdrawn: the template is withdrawn now.
  assert.deepEqual(
    editionStanding(recorded, {
      ...later,
      withdrawn: true,
      withdrawnAt,
      reason: "Another synthetic reason.",
    }),
    { state: "withdrawn", since: withdrawnAt, reason: "Another synthetic reason.", current: null },
  );
  // An earlier or equal version is never a later release.
  assert.equal(editionStanding({ ...recorded, version: 2 }, later), null);
  assert.equal(editionStanding({ ...recorded, version: 3 }, later), null);
});
