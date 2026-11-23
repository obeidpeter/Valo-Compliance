import {
  Answer,
  ProfileLegalForm,
  ProfileRegistrationStatus,
  ProfileState,
  ProfileTurnoverBand,
  ProfileTurnoverCurrency,
  ProfileTurnoverMetric,
  type CheckerFacts,
  type Profile,
} from "@workspace/api-client-react";
import { isMarker, valueLabel } from "@/lib/checker";

function inEnum<T extends string>(enumObj: Record<string, T>, value: unknown): value is T {
  return typeof value === "string" && Object.values(enumObj).includes(value as T);
}

function isSubstantiveEnum<T extends string>(enumObj: Record<string, T>, value: unknown): value is T {
  return inEnum(enumObj, value) && value !== "unanswered";
}

/**
 * Merges confirmed answers from a saved requirements check onto a business profile draft so the
 * owner does not have to re-enter the same facts on `/workspace/profile`. Never overwrites the
 * business name or marketing preference, and never replaces an already-filled profile answer with
 * an unanswered marker.
 */
export function profileFromAssessmentFacts(
  facts: CheckerFacts,
  base: Profile,
): { profile: Profile; appliedCount: number } {
  const next: Profile = { ...base, activities: [...base.activities] };
  let appliedCount = 0;

  if (isSubstantiveEnum(ProfileLegalForm, facts.legalForm)) {
    next.legalForm = facts.legalForm;
    appliedCount++;
  }
  if (isSubstantiveEnum(ProfileRegistrationStatus, facts.registrationStatus)) {
    next.registrationStatus = facts.registrationStatus;
    appliedCount++;
  }
  if (Array.isArray(facts.activities)) {
    const clean = facts.activities.map((a) => a.trim()).filter(Boolean);
    if (clean.length > 0) {
      next.activities = clean;
      appliedCount++;
    }
  }
  if (isSubstantiveEnum(ProfileState, facts.state)) {
    next.state = facts.state;
    appliedCount++;
  }
  if (typeof facts.lga === "string" && !isMarker(facts.lga) && facts.lga.trim()) {
    next.lga = facts.lga.trim();
    appliedCount++;
  }
  if (
    typeof facts.employees === "string" &&
    facts.employees !== "unanswered" &&
    (facts.employees === "unknown" ||
      facts.employees === "not_applicable" ||
      /^[0-9]{1,7}$/.test(facts.employees))
  ) {
    next.employees = facts.employees;
    appliedCount++;
  }
  if (isSubstantiveEnum(ProfileTurnoverBand, facts.turnoverBand)) {
    next.turnoverBand = facts.turnoverBand;
    appliedCount++;
  }
  if (
    typeof facts.turnoverYear === "string" &&
    (facts.turnoverYear === "unknown" || /^[0-9]{4}$/.test(facts.turnoverYear))
  ) {
    next.turnoverYear = facts.turnoverYear;
    appliedCount++;
  }
  if (isSubstantiveEnum(ProfileTurnoverMetric, facts.turnoverMetric)) {
    next.turnoverMetric = facts.turnoverMetric;
    appliedCount++;
  }
  if (isSubstantiveEnum(ProfileTurnoverCurrency, facts.turnoverCurrency)) {
    next.turnoverCurrency = facts.turnoverCurrency;
    appliedCount++;
  }
  if (isSubstantiveEnum(Answer, facts.premises)) {
    next.premises = facts.premises;
    appliedCount++;
  }
  if (isSubstantiveEnum(Answer, facts.manufacturing)) {
    next.manufacturing = facts.manufacturing;
    appliedCount++;
  }
  if (isSubstantiveEnum(Answer, facts.importing)) {
    next.importing = facts.importing;
    appliedCount++;
  }
  if (isSubstantiveEnum(Answer, facts.personalData)) {
    next.personalData = facts.personalData;
    appliedCount++;
  }

  return { profile: next, appliedCount };
}

/**
 * Formats a saved business profile's summary rows for Workspace Home using plain customer labels,
 * avoiding raw enum tokens such as `unanswered` or `not_registered`.
 */
export function formatProfileSummary(
  profile: Pick<Profile, "legalForm" | "registrationStatus" | "lga" | "state">,
): { legalForm: string; registration: string; location: string } {
  const lga = profile.lga.trim();
  const state = profile.state.trim();
  let location: string;
  if (!state || state === "unanswered") {
    location = lga || "Not given";
  } else if (isMarker(state)) {
    location = lga || valueLabel(state);
  } else {
    location = [lga, valueLabel(state)].filter(Boolean).join(", ");
  }

  return {
    legalForm: valueLabel(profile.legalForm),
    registration: valueLabel(profile.registrationStatus),
    location,
  };
}
