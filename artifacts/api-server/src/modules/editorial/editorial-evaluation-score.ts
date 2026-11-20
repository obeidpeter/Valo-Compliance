/**
 * EDP-010's bar for the 60 editorial cases: zero critical false publications and at least 95% of
 * the cases passing. A case that is blocked, not selected or not yet run has not passed. The score
 * measures a run against that bar. It never accepts EDP-010, which needs the owner's review, and it
 * is never a legal-accuracy figure.
 */
export type EditorialCaseOutcome = {
  caseID: string;
  /** control_pass and case_pass count as passed; every other status does not. */
  status: string;
  /** Set by the runner when an item that should have been held was published or found eligible. */
  criticalFalsePublication?: boolean;
};

export const editorialPassStatuses = ["control_pass", "case_pass"] as const;
const passing = new Set<string>(editorialPassStatuses);

export function scoreEditorialEvaluation(corpusCaseIds: readonly string[], results: EditorialCaseOutcome[]) {
  if (!corpusCaseIds.length || new Set(corpusCaseIds).size !== corpusCaseIds.length)
    throw Error("EDITORIAL_CORPUS_IDS_INVALID");
  const seen = new Map<string, EditorialCaseOutcome>();
  for (const result of results) {
    if (!corpusCaseIds.includes(result.caseID) || seen.has(result.caseID))
      throw Error("EDITORIAL_RESULTS_DO_NOT_MATCH_CORPUS");
    seen.set(result.caseID, result);
  }
  if (seen.size !== corpusCaseIds.length) throw Error("EDITORIAL_RESULTS_DO_NOT_MATCH_CORPUS");
  const passed = results.filter((r) => passing.has(r.status)).length;
  const failed = results.filter((r) => r.status === "fail").length;
  const criticalFalsePublications = results.filter((r) => r.criticalFalsePublication === true).length;
  const required = Math.ceil(corpusCaseIds.length * 0.95);
  return {
    cases: corpusCaseIds.length,
    passed,
    failed,
    notPassedOrNotRun: corpusCaseIds.length - passed,
    criticalFalsePublications,
    requiredToPass: required,
    meetsEdp010Bar: criticalFalsePublications === 0 && passed >= required,
    legalAccuracyClaimed: false as const,
    accepted: false as const,
  };
}
