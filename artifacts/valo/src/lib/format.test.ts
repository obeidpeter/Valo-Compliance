import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKobo } from "@workspace/valo-core/money";
import { formatCount, formatDateTime, formatDay, formatFileSize, formatNaira, lagosToday } from "./format";

test("an instant is written as its day and time on a Lagos clock, the month as a word, whatever the time zone it was given in (NFR-008)", () => {
  assert.equal(formatDateTime("2026-11-18T08:00:00.000Z"), "18 Nov 2026, 09:00");
  assert.equal(formatDateTime("2026-11-18T09:00:00+01:00"), "18 Nov 2026, 09:00");
  assert.equal(formatDateTime(new Date("2026-11-18T08:00:00Z")), "18 Nov 2026, 09:00");
  // Evening in UTC is already the next day in Lagos, and midnight there is written 00:00.
  assert.equal(formatDateTime("2026-12-31T23:30:00Z"), "1 Jan 2027, 00:30");
  assert.equal(formatDateTime("2026-11-17T23:00:00Z"), "18 Nov 2026, 00:00");
  assert.equal(formatDay("2026-12-31T23:30:00Z"), "1 Jan 2027");
  assert.equal(formatDay("2026-11-18T08:00:00Z"), "18 Nov 2026");
  // Every month's name, from one list.
  assert.deepEqual(
    Array.from(
      { length: 12 },
      (_, month) => formatDay(new Date(Date.UTC(2026, month, 15, 12))).split(" ")[1],
    ),
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  );
});

test("the text does not depend on the machine's own time zone", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Africa/Lagos"]) {
      process.env.TZ = zone;
      assert.equal(formatDateTime("2026-11-18T08:00:00Z"), "18 Nov 2026, 09:00", zone);
      assert.equal(formatDay("2026-11-18T23:30:00Z"), "19 Nov 2026", zone);
      assert.equal(formatDay("2026-11-18"), "18 Nov 2026", zone);
      assert.equal(lagosToday(new Date("2026-11-18T23:30:00Z")), "2026-11-19", zone);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("a calendar date is the same day wherever it is read, and text that names no date comes back unchanged", () => {
  assert.equal(formatDay("2026-12-01"), "1 Dec 2026");
  assert.equal(formatDay("2028-02-29"), "29 Feb 2028");
  // A calendar date has no time, so none is invented for it.
  assert.equal(formatDateTime("2026-12-01"), "1 Dec 2026");
  // Not real days, and not dates at all.
  for (const text of ["2027-02-29", "2026-13-01", "2026-00-10", "not yet", ""]) {
    assert.equal(formatDay(text), text);
    assert.equal(formatDateTime(text), text);
  }
});

test("today in Lagos is a calendar date, a day ahead of UTC in the last hour of the UTC day", () => {
  assert.equal(lagosToday(new Date("2026-11-18T22:59:59Z")), "2026-11-18");
  assert.equal(lagosToday(new Date("2026-11-18T23:00:00Z")), "2026-11-19");
  assert.equal(lagosToday(new Date("2026-01-05T10:00:00Z")), "2026-01-05");
  assert.match(lagosToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("an amount of kobo is written in naira with the naira sign, grouped thousands and two decimal places (NFR-008)", () => {
  assert.equal(formatNaira(150000), "₦1,500.00");
  assert.equal(formatNaira("150000"), "₦1,500.00");
  assert.equal(formatNaira(150000n), "₦1,500.00");
  assert.equal(formatNaira(0), "₦0.00");
  assert.equal(formatNaira(5), "₦0.05");
  assert.equal(formatNaira(99), "₦0.99");
  assert.equal(formatNaira(100), "₦1.00");
  assert.equal(formatNaira(-250050), "-₦2,500.50");
  assert.equal(formatNaira("000150000"), "₦1,500.00");
  // Larger than a number can hold exactly: no digit is lost.
  assert.equal(formatNaira("123456789012345678901234"), "₦1,234,567,890,123,456,789,012.34");
  // Not whole kobo: shown as written, never rounded into a different amount.
  assert.equal(formatNaira(1500.5), "1500.5");
  assert.equal(formatNaira("12.50"), "12.50");
  assert.equal(formatNaira(Number.NaN), "NaN");
});

test("the site and the documents write the same amount the same way", () => {
  for (const kobo of [
    "0",
    "5",
    "99",
    "100",
    "150000",
    "100000000",
    "999999999999",
    "123456789012345678901234",
  ])
    assert.equal(formatNaira(kobo), formatKobo(kobo), kobo);
});

test("a count is written with its thousands grouped", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1,000");
  assert.equal(formatCount(12345678), "12,345,678");
  assert.equal(formatCount(-12345), "-12,345");
  assert.equal(formatCount(1.5), "1.5");
});

test("a file's size is written in kilobytes, a part of one counting as a whole, and in megabytes from a million bytes", () => {
  assert.equal(formatFileSize(1), "1 KB");
  assert.equal(formatFileSize(1000), "1 KB");
  assert.equal(formatFileSize(12345), "13 KB");
  assert.equal(formatFileSize(999_999), "1,000 KB");
  assert.equal(formatFileSize(1_000_000), "1.0 MB");
  assert.equal(formatFileSize(1_449_000), "1.4 MB");
});
