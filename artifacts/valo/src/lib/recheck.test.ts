import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile } from "@workspace/api-client-react";
import { profileAnswersToCheckAgain } from "@workspace/valo-core/profile-recheck";
import { factsFromProfile, finaliseFacts } from "./checker";
import { followedResult, recheckHref, recheckWords, savedResultHref } from "./recheck";

const RESULT = "00000000-0000-4000-8000-00000000a001";
const profile: Profile = {
  businessName: "Synthetic Trading Ltd",
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
  marketingConsent: false,
};
/** What the check's page sends when it is filled in from a profile and nothing is changed. */
const sent = (from: Profile) => ({ ...finaliseFacts(factsFromProfile(from)) });

test("PRO-003: the offer names the changed answers as a saved result names them, and the result's time on a Lagos clock", () => {
  const one = recheckWords({
    assessmentId: RESULT,
    savedAt: "2026-11-18T08:00:00.000Z",
    changed: ["employees"],
  });
  assert.deepEqual(one, {
    title: "Your business profile has changed since your last saved result",
    changed: "This answer has changed since the result saved on 18 Nov 2026, 09:00: Employees.",
    kept: "Check again to see what that means for your requirements. Your saved results and your tasks stay as they are.",
    action: "Check again with my profile",
  });
  assert.equal(
    recheckWords({ assessmentId: RESULT, savedAt: "2026-11-18T08:00:00.000Z", changed: ["state", "lga"] })
      .changed,
    "These answers have changed since the result saved on 18 Nov 2026, 09:00: State or FCT and Local government area.",
  );
  assert.equal(
    recheckWords({
      assessmentId: RESULT,
      savedAt: "2026-12-31T23:30:00.000Z",
      changed: ["activities", "state", "lga", "employees"],
    }).changed,
    "These answers have changed since the result saved on 1 Jan 2027, 00:30: Activities, State or FCT, Local government area and Employees.",
  );
});

test("PRO-003: the offer opens the check filled in from the profile, and the new result opens compared with the one it follows", () => {
  const href = recheckHref({ assessmentId: RESULT });
  assert.equal(href, `/workspace/checker?prefill=profile&since=${RESULT}`);
  const search = href.slice(href.indexOf("?"));
  assert.equal(new URLSearchParams(search).get("prefill"), "profile");
  assert.equal(followedResult(search), RESULT);
  // Only a saved result's own id is carried into the next page's address.
  for (const other of ["", "?since=", "?since=latest", `?since=${RESULT}/../x`, "?since=%22%3E%3Cscript%3E"])
    assert.equal(followedResult(other), "", other);
  const saved = "00000000-0000-4000-8000-00000000a002";
  assert.equal(savedResultHref(saved, RESULT), `/workspace/assessments/${saved}?compare=${RESULT}`);
  assert.equal(savedResultHref(saved, ""), `/workspace/assessments/${saved}`);
  assert.equal(
    savedResultHref(saved, saved),
    `/workspace/assessments/${saved}`,
    "a result is not compared with itself",
  );
});

test("PRO-003: a result saved from the check's page, filled in from a profile, leaves nothing to check again for that profile", () => {
  // The server compares a profile with the answers a result used. What it takes from a profile is
  // what this page sends from it: with no profile before, every answer is compared.
  const profiles: Profile[] = [
    profile,
    { ...profile, lga: "", employees: "unknown", legalForm: "unknown", turnoverYear: "unknown" },
    { ...profile, lga: "  Ikeja  ", activities: [" retail ", "retail", "Selling fabric wholesale"] },
    // An area without a state: the page does not ask the area.
    { ...profile, state: "unanswered", lga: "Ikeja" },
    { ...profile, state: "unknown", lga: "Ikeja" },
    // Turnover that does not apply: the page does not ask its year, its measure or its currency.
    { ...profile, turnoverBand: "not_applicable" },
    { ...profile, turnoverBand: "not_applicable", turnoverYear: "unknown", turnoverMetric: "unknown" },
    { ...profile, employees: "not_applicable", premises: "not_applicable", personalData: "unanswered" },
  ];
  for (const from of profiles)
    assert.deepEqual(
      profileAnswersToCheckAgain({ before: null, current: from, used: sent(from) }),
      [],
      JSON.stringify(from),
    );
  // And a profile that says something else than the page sent is offered for exactly that.
  assert.deepEqual(
    profileAnswersToCheckAgain({
      before: null,
      current: { ...profile, state: "Bayelsa", lga: "Yenagoa", employees: "6" },
      used: sent(profile),
    }),
    ["state", "lga", "employees"],
  );
});
