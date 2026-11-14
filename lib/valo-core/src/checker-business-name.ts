import { z } from "zod";
import { digest } from "./publication";

/**
 * Isolated pre-publication candidate semantics, NOT a released customer rule.
 * Supplied true names are facts; this code never guesses a person's name,
 * corporate status, court appointment or exception from a trade name.
 */
const unanswered = z.object({
  status: z.enum(["unknown", "unanswered", "not_applicable"]),
  value: z.null(),
}).strict();
const text = z.union([z.string().min(1).max(300), unanswered]);
const flag = z.union([z.boolean(), unanswered]);
const names = z.union([z.array(z.string().min(1).max(150)).max(20), unanswered]);
const partner = z.object({
  type: z.union([z.enum(["individual", "corporation"]), unanswered]).optional(),
  surname: text.optional(),
  forenames: names.optional(),
  recognizedAbbreviations: names.optional(),
  corporateName: text.optional(),
}).strict();
export const businessNameFactsSchema = z.object({
  legalForm: text.optional(),
  hasPlaceOfBusinessInNigeria: flag.optional(),
  carryingOnBusiness: flag.optional(),
  trueSurname: text.optional(),
  trueForenames: names.optional(),
  recognizedAbbreviations: names.optional(),
  businessName: text.optional(),
  corporateName: text.optional(),
  partners: z.union([z.array(partner).max(30), unanswered]).optional(),
  operatorRole: text.optional(),
  appointmentAuthority: text.optional(),
  appointmentConfirmed: flag.optional(),
  section814Exception: text.optional(),
  namingAssessment: z.union([z.object({
    onlyAddedWordsIndicateSuccession: flag.optional(),
    otherBrandAddition: flag.optional(),
    sameSurnameAllPartners: flag.optional(),
    onlyAdditionIsPluralS: flag.optional(),
  }).strict(), unanswered]).optional(),
  registrationStatus: text.optional(),
  businessNameRegistered: flag.optional(),
}).passthrough();

export type CandidateLabel = "Likely relevant" | "May apply" |
  "More information needed" | "Not indicated by these answers";
type MissingState = z.infer<typeof unanswered>["status"];
type MissingFact = { field: string; state: MissingState };
export type BusinessNameCandidateBinding = {
  mode: "isolated_candidate_validation";
  candidateVersion: string;
  bindingHash: string;
  sourceVersionHashes: Record<string, string>;
  /** Evaluation scope, not a fabricated statutory commencement/expiry. */
  supportedAssessmentDates: readonly string[];
};
type Facts = z.infer<typeof businessNameFactsSchema>;
type Names = { surname: string; forenames: string[]; abbreviations: string[] };
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const state = (v: unknown): MissingState =>
  v && typeof v === "object" && "status" in v &&
  ["unknown", "unanswered", "not_applicable"].includes(String(v.status))
    ? v.status as MissingState : v === undefined ? "unanswered" : "unknown";
const canonical = (v: string) => v.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-NG");
const words = (v: string) => canonical(v).replace(/\./gu, "").split(/\s+/u);
const hasPhrase = (value: string, phrase: string) =>
  ` ${words(value).join(" ")} `.includes(` ${words(phrase).join(" ")} `);

function collectNames(
  source: { surname?: z.infer<typeof text>; forenames?: z.infer<typeof names>;
    recognizedAbbreviations?: z.infer<typeof names> },
  path: string,
): { names?: Names; missing: MissingFact[] } {
  const missing: MissingFact[] = [];
  if (!isText(source.surname)) missing.push({ field: `${path}surname`, state: state(source.surname) });
  if (!Array.isArray(source.forenames))
    missing.push({ field: `${path}forenames`, state: state(source.forenames) });
  if (source.recognizedAbbreviations !== undefined && !Array.isArray(source.recognizedAbbreviations))
    missing.push({ field: `${path}recognizedAbbreviations`, state: state(source.recognizedAbbreviations) });
  return { missing, ...(missing.length ? {} : { names: {
    surname: source.surname as string,
    forenames: source.forenames as string[],
    abbreviations: (source.recognizedAbbreviations as string[] | undefined) ?? [],
  } }) };
}

/** Exact, conservative comparison to the supplied true-name facts, not fuzzy name inference. */
function compareNames(businessName: string, people: Names[]) {
  const omitted = people.some(p => !hasPhrase(businessName, p.surname));
  const allowed = new Set(people.flatMap(p => [
    ...words(p.surname),
    ...p.forenames.flatMap(n => [...words(n), ...words(n).map(w => [...w][0]!)]),
    ...p.abbreviations.flatMap(words),
  ]));
  return { omitted, addition: words(businessName).some(w => !allowed.has(w)) };
}

export function evaluateBusinessNameCandidate(
  rawFacts: unknown,
  assessmentDate: string,
  binding: BusinessNameCandidateBinding,
) {
  if (binding.mode !== "isolated_candidate_validation" || !binding.candidateVersion ||
      !/^[a-f0-9]{64}$/u.test(binding.bindingHash) ||
      !Object.keys(binding.sourceVersionHashes).length ||
      Object.values(binding.sourceVersionHashes).some(h => !/^[a-f0-9]{64}$/u.test(h)))
    throw new Error("An exact isolated source/candidate binding is required");
  z.string().date().parse(assessmentDate);
  if ((JSON.stringify(rawFacts) ?? "null").length > 40_000) throw new Error("Candidate facts exceed the bounded schema");
  const result = businessNameFactsSchema.safeParse(rawFacts);
  const inputHash = digest(rawFacts ?? null);
  const finish = (label: CandidateLabel, reason: string, missingFacts: MissingFact[] = [],
    matchedFacts: string[] = []) => {
    const facts = result.success ? result.data : undefined;
    const alreadyRegistered = facts?.businessNameRegistered === true ||
      facts?.registrationStatus === "registered_for_exact_name_and_operator";
    const body = {
      candidateId: "CAC-BUSINESS-NAME-814",
      authoredSourceCandidateId: "CAND-CAMA-814-BUSINESS-NAME",
      candidateVersion: binding.candidateVersion, bindingHash: binding.bindingHash,
      sourceVersionHashes: binding.sourceVersionHashes, inputHash, assessmentDate,
      label, reason, missingFacts, matchedFacts,
      availability: "offline_candidate_only",
      eligibleForCustomerUse: false,
      releasedManifestId: null,
      automaticStatutoryDeadline: null,
      automaticReminder: false,
      createRegistrationTask: false,
      candidateTaskSuggestion: label === "Likely relevant" && !alreadyRegistered
        ? "Review the exact-name/operator registration position; no customer task is created." : null,
      registrationAction: alreadyRegistered
        ? "Check the existing exact-name/operator record; do not create a duplicate registration task."
        : "Check the exact name and operator's registration position with CAC before choosing an action.",
      stateAndLocalCoverage: "not_evaluated",
      gaps: ["This national naming check establishes no state/FCT/LGA coverage.",
        "A negative naming result is not a general registration exemption under CAMA section 863 or other law."],
    };
    return { ...body, resultHash: digest(body) };
  };
  if (!result.success)
    return finish("More information needed", "The supplied structured facts are invalid.",
      result.error.issues.map(i => ({ field: i.path.join("."), state: "unknown" })));
  const f: Facts = result.data;
  if (!binding.supportedAssessmentDates.includes(assessmentDate))
    return finish("More information needed",
      "The assessment date is outside this candidate's checked research context; bind the appropriate period evidence.");
  for (const field of ["hasPlaceOfBusinessInNigeria", "carryingOnBusiness"] as const)
    if (f[field] === false)
      return finish("Not indicated by these answers",
        `The supplied ${field} fact is false; this section 814 naming trigger is not indicated.`, [], [field]);
  const baseMissing = (["hasPlaceOfBusinessInNigeria", "carryingOnBusiness"] as const)
    .filter(field => f[field] !== true).map(field => ({ field, state: state(f[field]) }));
  if (baseMissing.length) return finish("More information needed",
    "Confirm the Nigerian place of business and that business is being carried on under the name.", baseMissing);
  let courtMissing: MissingFact | undefined;
  if (f.operatorRole === "manager" || f.operatorRole === "receiver") {
    if (f.appointmentAuthority === "court" && f.appointmentConfirmed === true)
      return finish("Not indicated by these answers",
        "The business is carried on by the confirmed court-appointed receiver or manager: section 814(2)(c).",
        [], ["carryingOnBusiness", "operatorRole", "appointmentAuthority", "appointmentConfirmed"]);
    if (f.appointmentAuthority !== "private_contract")
      courtMissing = { field: f.appointmentAuthority === "court" ? "appointmentConfirmed" : "appointmentAuthority",
        state: state(f.appointmentAuthority === "court" ? f.appointmentConfirmed : f.appointmentAuthority) };
  } else if (isText(f.section814Exception) && /court|unverified/iu.test(f.section814Exception)) {
    courtMissing = { field: "operatorRole/appointmentAuthority/appointmentConfirmed", state: "unanswered" };
  }
  if (!["individual", "firm", "company"].includes(String(f.legalForm)))
    return finish("More information needed", "The operator form is missing or outside this narrow supported scope.",
      [{ field: "legalForm", state: state(f.legalForm) }]);
  if (!isText(f.businessName))
    return finish("More information needed", "Supply the actual name used for this business.",
      [{ field: "businessName", state: state(f.businessName) }]);
  let people: Names[] = [];
  if (f.legalForm === "company") {
    if (!isText(f.corporateName)) return finish("More information needed", "Supply the confirmed corporate name.",
      [{ field: "corporateName", state: state(f.corporateName) }]);
    if (canonical(f.businessName) === canonical(f.corporateName))
      return finish("Not indicated by these answers", "The supplied business name is the exact corporate name: section 814(1)(c).",
        [], ["businessName", "corporateName"]);
  } else if (f.legalForm === "individual") {
    if (isText(f.trueSurname) && canonical(f.businessName) === canonical(f.trueSurname))
      return finish("Not indicated by these answers",
        "The supplied name is exactly the confirmed true surname/patronymic; no addition needs classifying under section 814(1)(b).",
        [], ["businessName", "trueSurname"]);
    const collected = collectNames({
      surname: f.trueSurname, forenames: f.trueForenames, recognizedAbbreviations: f.recognizedAbbreviations,
    }, "individual.");
    if (collected.missing.length) return finish("More information needed",
      "Confirm true surname/patronymic and forenames; do not infer them from the trading name.", collected.missing);
    people = [collected.names!];
  } else {
    if (!Array.isArray(f.partners) || f.partners.length < 2)
      return finish("More information needed", "Supply all relevant individual partners, not only the first partner.",
        [{ field: "partners", state: state(f.partners) }]);
    for (const [i, p] of f.partners.entries()) {
      if (p.type === "corporation" || p.corporateName !== undefined ||
          (p.type !== undefined && p.type !== "individual"))
        return finish("More information needed", "Mixed or unclassified corporate-partner firms require a separately supported rule.",
          [{ field: `partners.${i}.type`, state: state(p.type) }]);
      // A supplied true surname/forenames record asserts an individual partner;
      // no corporate surname is manufactured and no name is extracted from a brand.
      const collected = collectNames(p, `partners.${i}.`);
      if (collected.missing.length) return finish("More information needed",
        "Confirm every relevant partner's true-name facts.", collected.missing);
      people.push(collected.names!);
    }
  }
  if (people.length) {
    const base = compareNames(f.businessName, people);
    if (!base.omitted && !base.addition)
      return finish("Not indicated by these answers",
        "The supplied name contains all required true surnames and only supplied forenames/initials: section 814(1)(a)/(b), with section 868 definitions.",
        [], ["businessName", f.legalForm === "firm" ? "partners" : "trueSurname/trueForenames"]);
  }
  if (courtMissing) return finish("More information needed",
    "The potentially material court appointment is not confirmed; a label alone cannot establish it.", [courtMissing]);
  const naming = f.namingAssessment && !("status" in f.namingAssessment) ? f.namingAssessment : undefined;
  if (naming?.sameSurnameAllPartners === true &&
      new Set(people.map(p => canonical(p.surname))).size > 1)
    return finish("More information needed", "The shared-surname assertion conflicts with the supplied partner names.",
      [{ field: "namingAssessment.sameSurnameAllPartners", state: "unknown" }]);
  let baseName = f.businessName;
  if (isText(f.section814Exception) && f.section814Exception.startsWith("succession")) {
    if (!naming || typeof naming.onlyAddedWordsIndicateSuccession !== "boolean" ||
        typeof naming.otherBrandAddition !== "boolean")
      return finish("More information needed", "Confirm the succession wording and whether any independent addition remains.",
        [{ field: "namingAssessment", state: state(f.namingAssessment) }]);
    const split = baseName.split(/\s+successors?\s+to\s+/iu);
    if (split.length !== 2 || !split[0] || !split[1])
      return finish("More information needed", "The confirmed succession-only portion needs an explicit supported name-composition record.",
        [{ field: "namingAssessment.successionNameComposition", state: "unanswered" }]);
    baseName = split[0];
    if (naming.onlyAddedWordsIndicateSuccession === naming.otherBrandAddition)
      return finish("More information needed", "The succession and independent-addition facts conflict.",
        [{ field: "namingAssessment", state: "unknown" }]);
  }
  if (f.legalForm === "firm" && naming?.onlyAdditionIsPluralS === true) {
    const counts = new Map<string, number>();
    for (const p of people) counts.set(canonical(p.surname), (counts.get(canonical(p.surname)) ?? 0) + 1);
    for (const [surname, count] of counts)
      if (count >= 2) baseName = words(baseName).map(w => w === `${surname}s` ? surname : w).join(" ");
  }
  const baseSatisfied = f.legalForm === "company"
    ? canonical(baseName) === canonical(f.corporateName as string)
    : !Object.values(compareNames(baseName, people)).some(Boolean);
  if (baseSatisfied)
    return finish("Not indicated by these answers",
      "After only the confirmed qualifying succession/plural addition, the applicable base-name condition is satisfied: section 814(2)(a)/(b).",
      [], ["businessName", "namingAssessment", f.legalForm === "firm" ? "partners" :
        f.legalForm === "company" ? "corporateName" : "trueSurname/trueForenames"]);
  if (!isText(f.section814Exception) ||
      !["none", "succession_only_confirmed", "succession_claim_with_other_addition",
        "shared_surname_plural_s_confirmed"].includes(f.section814Exception))
    return finish("More information needed", "A potentially material exception has not been resolved by supporting facts.",
      [{ field: "section814Exception", state: state(f.section814Exception) }]);
  const omitted = people.flatMap((p, i) => hasPhrase(baseName, p.surname) ? [] : [i + 1]);
  const why = f.legalForm === "company" ? "The supplied trading name differs from the confirmed corporate name: section 814(1)(c)." :
    omitted.length ? `The supplied name omits the confirmed surname for ${f.legalForm === "firm" ? `partner positions ${omitted.join(", ")}` : "the individual"}: section 814(1)(a)/(b).` :
      "The supplied name contains an independent addition outside the recorded true names, initials or confirmed qualifying additions: section 814(1)(a)/(b).";
  return finish("Likely relevant", `${why} This is naming relevance, not a breach or incorporation decision.`,
    [], ["hasPlaceOfBusinessInNigeria", "carryingOnBusiness", "legalForm", "businessName", "section814Exception",
      f.legalForm === "firm" ? "partners" : f.legalForm === "company" ? "corporateName" : "trueSurname/trueForenames"]);
}
