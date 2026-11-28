import { isAsked } from "./checker-questionnaire";

/**
 * PRO-003: "Version relevant profile changes and offer a new requirements assessment". The answers
 * the requirements check takes from a business profile, in the order the profile asks them. The
 * check reads neither the profile's business name nor its marketing choice, so a change to those
 * alone offers nothing.
 */
export const PROFILE_CHECK_ANSWERS = [
  "legalForm",
  "registrationStatus",
  "activities",
  "state",
  "lga",
  "employees",
  "turnoverBand",
  "turnoverYear",
  "turnoverMetric",
  "turnoverCurrency",
  "premises",
  "manufacturing",
  "importing",
  "personalData",
] as const;
export type ProfileCheckAnswer = (typeof PROFILE_CHECK_ANSWERS)[number];

/** An answer still to be given, however it is stored: left out, empty, not known or skipped. */
const NOT_GIVEN = "";

/**
 * One answer in a form two can be compared in. "I do not know" and a skipped question are one
 * answer still to be given, as a result counts them; "not applicable" is an answer. A list is the
 * same list in any order, and spaces around an answer are not part of it.
 */
function comparable(value: unknown): string {
  if (Array.isArray(value)) {
    const entries = [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))].sort((a, b) =>
      a < b ? -1 : 1,
    );
    return entries.length ? JSON.stringify(entries) : NOT_GIVEN;
  }
  if (typeof value !== "string")
    return value === undefined || value === null ? NOT_GIVEN : JSON.stringify(value);
  const text = value.trim();
  return text === "unknown" || text === "unanswered" ? NOT_GIVEN : text;
}

/**
 * What the check takes from a profile for each of those answers, as its page sends them once it is
 * filled in from the profile: an answer the page does not ask, given the profile's other answers, is
 * not taken as the profile has it.
 */
function taken(profile: Record<string, unknown> | null): Record<ProfileCheckAnswer, string> {
  const answers = Object.fromEntries(
    PROFILE_CHECK_ANSWERS.map((key) => [key, comparable(profile?.[key])]),
  ) as Record<ProfileCheckAnswer, string>;
  // The area is asked once a state is chosen.
  if (!isAsked(profile ?? {}, "lga")) answers.lga = NOT_GIVEN;
  // A business that turnover does not apply to is not asked its year, its measure or its currency.
  for (const key of ["turnoverYear", "turnoverMetric", "turnoverCurrency"] as const)
    if (!isAsked(profile ?? {}, key)) answers[key] = "not_applicable";
  return answers;
}

/**
 * The profile's answers that a new requirements check is offered for, after a saved result:
 *
 * - those the profile has changed since that result was saved (`before` is the profile as it was
 *   then, or null when none was saved by then), and
 * - that the result was not worked out from already (`used`, the result's own answers). The check's
 *   page lets a business answer differently from its profile, and a saved result's answers can be
 *   copied into the profile afterwards: neither leaves anything to check again.
 *
 * An answer the profile and the result give differently, but that the profile has not changed, is
 * not listed: the business answered the check that way itself.
 */
export function profileAnswersToCheckAgain(input: {
  before: Record<string, unknown> | null;
  current: Record<string, unknown>;
  used: Record<string, unknown>;
}): ProfileCheckAnswer[] {
  const before = taken(input.before),
    current = taken(input.current);
  return PROFILE_CHECK_ANSWERS.filter(
    (key) => current[key] !== before[key] && current[key] !== comparable(input.used[key]),
  );
}
