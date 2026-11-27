import assert from "node:assert/strict";
import { test } from "node:test";
import { SaveBusinessProfileBody } from "@workspace/api-zod";
import { factNames, PROFILE_CHECK_ANSWERS, profileAnswersToCheckAgain } from "@workspace/valo-core";
import { syntheticProfile } from "../../lib/valo-test-fixtures";

/** A profile whose every answer to the check is given. */
const profile = {
  ...syntheticProfile,
  legalForm: "limited_company",
  registrationStatus: "registered",
  activities: ["retail", "Selling fabric wholesale"],
  state: "Lagos",
  lga: "Ikeja",
  employees: "3",
  turnoverBand: "5m_to_25m",
  turnoverYear: "2025",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "yes",
  manufacturing: "no",
  importing: "no",
  personalData: "yes",
};
/** The answers a result saved from that profile was worked out from. */
const usedFrom = (from: Record<string, unknown>) =>
  Object.fromEntries(PROFILE_CHECK_ANSWERS.map((key) => [key, from[key]]));
const changed = (
  before: Record<string, unknown> | null,
  current: Record<string, unknown>,
  used: Record<string, unknown> = usedFrom(before ?? {}),
) => profileAnswersToCheckAgain({ before, current, used });

test("PRO-003: the answers the check takes from a profile are the profile's own, less its name and the marketing choice", () => {
  const profileKeys = Object.keys(SaveBusinessProfileBody.shape.profile.shape);
  assert.deepEqual(
    [...PROFILE_CHECK_ANSWERS].sort(),
    profileKeys.filter((key) => (factNames as readonly string[]).includes(key)).sort(),
    "every profile answer the check has a question for, and no other",
  );
  assert.deepEqual(
    profileKeys.filter((key) => !(PROFILE_CHECK_ANSWERS as readonly string[]).includes(key)).sort(),
    ["businessName", "marketingConsent"],
  );
});

test("PRO-003: a changed location, activity or employee count is offered for a new check, in the profile's order", () => {
  assert.deepEqual(changed(profile, { ...profile, state: "Bayelsa" }), ["state"]);
  assert.deepEqual(changed(profile, { ...profile, lga: "Surulere" }), ["lga"]);
  assert.deepEqual(changed(profile, { ...profile, activities: ["retail"] }), ["activities"]);
  assert.deepEqual(changed(profile, { ...profile, employees: "6" }), ["employees"]);
  assert.deepEqual(
    changed(profile, {
      ...profile,
      personalData: "no",
      employees: "6",
      state: "Bayelsa",
      legalForm: "partnership",
    }),
    ["legalForm", "state", "employees", "personalData"],
  );
});

test("PRO-003: a change the check does not read offers nothing", () => {
  assert.deepEqual(changed(profile, profile), []);
  assert.deepEqual(changed(profile, { ...profile, businessName: "Another synthetic name" }), []);
  assert.deepEqual(changed(profile, { ...profile, marketingConsent: true }), []);
});

test("PRO-003: the same answer written another way is not a change", () => {
  // The same activities in another order, with spaces around them or given twice.
  assert.deepEqual(
    changed(profile, { ...profile, activities: [" Selling fabric wholesale ", "retail", "retail"] }),
    [],
  );
  assert.deepEqual(changed(profile, { ...profile, lga: " Ikeja " }), []);
  // "I do not know" and a skipped question are one answer still to be given.
  const unsure = { ...profile, employees: "unknown", premises: "unknown", state: "unknown", lga: "" };
  assert.deepEqual(
    changed(unsure, { ...unsure, employees: "unanswered", premises: "unanswered", state: "unanswered" }),
    [],
  );
  // "Not applicable" is an answer.
  assert.deepEqual(changed(unsure, { ...unsure, employees: "not_applicable" }), ["employees"]);
  // From an answer to none is a change too.
  assert.deepEqual(changed(profile, { ...profile, employees: "unknown" }), ["employees"]);
});

test("PRO-003: an answer the check does not ask is not taken as the profile has it", () => {
  // The area is asked once a state is chosen.
  const noState = { ...profile, state: "unanswered", lga: "Ikeja" };
  assert.deepEqual(changed(noState, { ...noState, lga: "Surulere" }), []);
  assert.deepEqual(
    changed(noState, { ...noState, state: "Lagos" }, { ...usedFrom(noState), lga: "unanswered" }),
    ["state", "lga"],
  );
  // A business that turnover does not apply to is not asked its year, its measure or its currency.
  const noTurnover = { ...profile, turnoverBand: "not_applicable" };
  assert.deepEqual(
    changed(noTurnover, { ...noTurnover, turnoverYear: "2024", turnoverMetric: "unknown" }),
    [],
  );
  assert.deepEqual(
    changed(profile, noTurnover, usedFrom(profile)),
    ["turnoverBand", "turnoverYear", "turnoverMetric", "turnoverCurrency"],
    "the three change with the band, as the check's page sends them",
  );
});

test("PRO-003: an answer the result was already worked out from is not offered again", () => {
  // The check's page lets a business answer differently from its profile: 6 employees, not 3.
  const used = { ...usedFrom(profile), employees: "6" };
  // The profile catches up, as "Copy answers to business profile" does.
  assert.deepEqual(changed(profile, { ...profile, employees: "6" }, used), []);
  // The profile moves to an answer the result did not use.
  assert.deepEqual(changed(profile, { ...profile, employees: "9" }, used), ["employees"]);
  // The profile and the result differ, but the profile has not changed that answer: the business
  // answered the check that way itself.
  assert.deepEqual(changed(profile, { ...profile, businessName: "Another synthetic name" }, used), []);
  assert.deepEqual(changed(profile, { ...profile, state: "Bayelsa" }, used), ["state"]);
});

test("PRO-003: a first profile saved after a result is compared with the answers that result used", () => {
  // A result saved before any profile, from the answers given on the check's page.
  const used = {
    ...usedFrom(profile),
    legalForm: "unanswered",
    turnoverYear: "unanswered",
    lga: "unanswered",
  };
  // Its answers copied into a first profile: the profile's form holds "I do not know" where the
  // result has a skipped question, and that is no change.
  assert.deepEqual(
    changed(null, { ...profile, legalForm: "unknown", turnoverYear: "unknown", lga: "" }, used),
    [],
  );
  // A first profile that says something else, or something more, than the result used.
  assert.deepEqual(
    changed(null, { ...profile, legalForm: "unknown", turnoverYear: "unknown", state: "Bayelsa" }, used),
    ["state", "lga"],
  );
  // A first profile that says less than the result used offers nothing: nothing new is known.
  assert.deepEqual(
    changed(
      null,
      { ...profile, legalForm: "unknown", turnoverYear: "unknown", lga: "", employees: "unknown" },
      used,
    ),
    [],
  );
});
