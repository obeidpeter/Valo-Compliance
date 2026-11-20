/**
 * How the site writes dates, times, amounts and counts (NFR-008): days and times on a Lagos clock,
 * whatever the viewer's or the server's time zone; the month as a word, so no date can be read two
 * ways; amounts in naira. Every screen writes them through this file, so they read the same
 * everywhere, and a page the server renders shows the same text once it is in the browser.
 *
 * The text is built from numbers, never from a locale's own words or punctuation, which differ
 * between a server and a browser and from one browser version to the next.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const lagosClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** What a Lagos calendar and clock show at an instant. */
function inLagos(instant: Date) {
  const part = Object.fromEntries(lagosClock.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(part.year),
    month: Number(part.month),
    day: Number(part.day),
    time: `${part.hour}:${part.minute}`,
  };
}

const written = (year: number, month: number, day: number) => `${day} ${MONTHS[month - 1]} ${year}`;

/** The instant a value names, or null when it names none. */
function instantOf(value: string | Date): Date | null {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** A calendar date written as year-month-day, such as a due date: a day, with no time or zone. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** How a calendar date is written; the text unchanged when it is no real day; null when the text is
 * not a calendar date at all. */
function calendarDay(value: string | Date): string | null {
  const calendar = typeof value === "string" ? CALENDAR_DATE.exec(value) : null;
  if (!calendar) return null;
  const [year, month, day] = [Number(calendar[1]), Number(calendar[2]), Number(calendar[3])];
  const real = new Date(Date.UTC(year, month - 1, day));
  return real.getUTCMonth() === month - 1 && real.getUTCDate() === day
    ? written(year, month, day)
    : String(value);
}

/**
 * A day, as "18 Nov 2026". A calendar date ("2026-11-18") is that day wherever it is read; an
 * instant is the day it falls on in Lagos. Text that names no date comes back unchanged.
 */
export function formatDay(value: string | Date): string {
  const calendar = calendarDay(value);
  if (calendar !== null) return calendar;
  const instant = instantOf(value);
  if (!instant) return String(value);
  const { year, month, day } = inLagos(instant);
  return written(year, month, day);
}

/**
 * An instant, as "18 Nov 2026, 09:00" on a Lagos clock. A calendar date has no time, so it is
 * written as its day alone. Text that names neither comes back unchanged.
 */
export function formatDateTime(value: string | Date): string {
  const calendar = calendarDay(value);
  if (calendar !== null) return calendar;
  const instant = instantOf(value);
  if (!instant) return String(value);
  const { year, month, day, time } = inLagos(instant);
  return `${written(year, month, day)}, ${time}`;
}

/** Today's calendar date in Lagos, as "2026-11-18". */
export function lagosToday(now = new Date()): string {
  const { year, month, day } = inLagos(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A whole number, as "12,345". Anything else comes back as it is written. */
export function formatCount(count: number): string {
  return Number.isSafeInteger(count)
    ? (count < 0 ? "-" : "") + grouped(String(Math.abs(count)))
    : String(count);
}

/**
 * An amount of whole kobo, as "₦1,500.00": the naira sign, thousands grouped, always two decimal
 * places. Exact for an amount of any size, as it never passes through a fraction. An amount that is
 * not whole kobo comes back as it is written.
 */
export function formatNaira(kobo: number | string | bigint): string {
  const text = typeof kobo === "number" && !Number.isSafeInteger(kobo) ? "" : String(kobo);
  const whole = /^(-?)(\d+)$/.exec(text);
  if (!whole) return String(kobo);
  const digits = whole[2]!.replace(/^0+(?=\d)/, "").padStart(3, "0");
  return `${whole[1]}₦${grouped(digits.slice(0, -2))}.${digits.slice(-2)}`;
}
