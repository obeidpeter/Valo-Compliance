import { test } from "node:test";
import assert from "node:assert/strict";
import { heldWords, isOverdue, reviewLine, reviewRecorded, reviewStatus } from "./library-review";

// EDP-011 (docs/architecture/guidance-currency.md, slice 2): the staff library's review words.
test("the staff library says when a published entry's review is due, and once overdue that customers cannot find, download or buy it", () => {
  const now = Date.parse("2026-11-25T10:00:00+01:00");
  const due = { version: 2, due: "2027-02-23T10:00:00+01:00" };
  assert.equal(reviewLine(due, now), "Review due 23 Feb 2027");
  assert.equal(reviewStatus(due, now), "Published version 2 is due for review on 23 Feb 2027.");
  assert.equal(isOverdue(due, now), false);

  const late = { version: 1, due: "2026-11-20T10:00:00+01:00" };
  assert.equal(reviewLine(late, now), "Review overdue since 20 Nov 2026");
  assert.equal(
    reviewStatus(late, now),
    `Published version 1 was due for review on 20 Nov 2026. ${heldWords}`,
  );
  assert.match(heldWords, /What they already have is unchanged/);
  assert.equal(isOverdue(late, now), true);
  // Due at this very moment counts as overdue: the database holds the entry from then.
  assert.equal(isOverdue({ version: 1, due: new Date(now).toISOString() }, now), true);

  assert.equal(
    reviewRecorded("2027-02-23T10:00:00+01:00"),
    "Review recorded. The next review is due on 23 Feb 2027.",
  );
});
