import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckerFacts, Profile } from "@workspace/api-client-react";
import { EMPTY_FACTS } from "./checker";
import { profileFromAssessmentFacts } from "./profile-prefill";

const BASE_PROFILE: Profile = {
  businessName: "Synthetic Ventures Ltd",
  legalForm: "unknown",
  registrationStatus: "unknown",
  activities: [""],
  state: "unanswered",
  lga: "",
  employees: "unanswered",
  turnoverBand: "unanswered",
  turnoverYear: "unknown",
  turnoverMetric: "unknown",
  turnoverCurrency: "unknown",
  premises: "unanswered",
  manufacturing: "unanswered",
  importing: "unanswered",
  personalData: "unanswered",
  marketingConsent: true,
};

test("profileFromAssessmentFacts maps answered check facts while preserving businessName and marketingConsent", () => {
  const facts: CheckerFacts = {
    ...EMPTY_FACTS,
    legalForm: "limited_company",
    registrationStatus: "registered",
    activities: ["  Retail trade  ", ""],
    state: "Lagos",
    lga: "Ikeja",
    employees: "12",
    turnoverBand: "5m_to_25m",
    turnoverYear: "2025",
    turnoverMetric: "gross_revenue",
    turnoverCurrency: "NGN",
    premises: "yes",
    manufacturing: "no",
    importing: "no",
    personalData: "yes",
  };

  const { profile, appliedCount } = profileFromAssessmentFacts(facts, BASE_PROFILE);
  assert.equal(appliedCount, 14);
  assert.equal(profile.businessName, "Synthetic Ventures Ltd");
  assert.equal(profile.marketingConsent, true);
  assert.equal(profile.legalForm, "limited_company");
  assert.equal(profile.registrationStatus, "registered");
  assert.deepEqual(profile.activities, ["Retail trade"]);
  assert.equal(profile.state, "Lagos");
  assert.equal(profile.lga, "Ikeja");
  assert.equal(profile.employees, "12");
  assert.equal(profile.turnoverBand, "5m_to_25m");
  assert.equal(profile.turnoverYear, "2025");
  assert.equal(profile.turnoverMetric, "gross_revenue");
  assert.equal(profile.turnoverCurrency, "NGN");
  assert.equal(profile.premises, "yes");
  assert.equal(profile.manufacturing, "no");
  assert.equal(profile.importing, "no");
  assert.equal(profile.personalData, "yes");
});

test("profileFromAssessmentFacts does not erase existing profile values with unanswered checker markers", () => {
  const existing: Profile = {
    ...BASE_PROFILE,
    legalForm: "business_name",
    state: "Abuja_FCT",
    lga: "Municipal",
    activities: ["Consulting"],
  };
  const { profile, appliedCount } = profileFromAssessmentFacts(EMPTY_FACTS, existing);
  assert.equal(appliedCount, 0);
  assert.equal(profile.legalForm, "business_name");
  assert.equal(profile.state, "Abuja_FCT");
  assert.equal(profile.lga, "Municipal");
  assert.deepEqual(profile.activities, ["Consulting"]);
});
