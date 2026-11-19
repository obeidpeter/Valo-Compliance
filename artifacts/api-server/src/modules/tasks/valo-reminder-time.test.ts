import { test } from "node:test";
import assert from "node:assert/strict";

// NFR-008: "Africa/Lagos user-facing deadlines; UTC event storage and unambiguous dates", accepted
// with "Timezone-boundary and naira/export glyph tests; unknown dates remain unset".
test("a reminder is due at 09:00 in Lagos on the chosen day, across month, year and leap-day boundaries", async () => {
  // The task code loads the database client; nothing here connects to it.
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
  const { reminderInstant } = await import("./valo-tasks");
  const lagos = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // [due date the user confirmed, days before, instant stored in UTC, as a reader in Lagos sees it]
  const cases = [
    ["2027-01-01", 0, "2027-01-01T08:00:00.000Z", "01/01/2027, 09:00"],
    ["2027-01-01", 1, "2026-12-31T08:00:00.000Z", "31/12/2026, 09:00"],
    ["2027-03-01", 1, "2027-02-28T08:00:00.000Z", "28/02/2027, 09:00"],
    ["2028-03-01", 1, "2028-02-29T08:00:00.000Z", "29/02/2028, 09:00"],
    ["2026-12-01", 14, "2026-11-17T08:00:00.000Z", "17/11/2026, 09:00"],
    // Lagos keeps one offset all year, so a mid-year date is due at the same UTC hour.
    ["2027-07-15", 7, "2027-07-08T08:00:00.000Z", "08/07/2027, 09:00"],
  ] as const;
  for (const [due, offset, utc, local] of cases) {
    const at = reminderInstant(due, offset);
    assert.equal(at.toISOString(), utc, `${due} minus ${offset}`);
    assert.equal(lagos.format(at), local, `${due} minus ${offset}`);
  }
  // A date that does not exist is refused, never rolled into the next month, and so is an offset
  // the product does not offer.
  assert.throws(() => reminderInstant("2027-02-29", 0));
  assert.throws(() => reminderInstant("2026-12-01", 2), { status: 422 });
});
