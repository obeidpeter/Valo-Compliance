import { evaluatePublication, publicationSchema } from "@workspace/valo-core";

/**
 * The editorial cases whose AI run is a template's own review pair (decision 0014): an original
 * operational template is prepared, both reviews run in an approved finite batch, and
 * publish-reviewed-pair.ts saves the version with its reviews, then publishes or holds it.
 */
export const templateEvaluationCases = {
  "EVAL-EDP-C001": "TPL-07",
  "EVAL-EDP-C002": "TPL-06",
  "EVAL-EDP-C003": "TPL-24",
} as const;
export type TemplateEvaluationCaseId = keyof typeof templateEvaluationCases;
export function isTemplateEvaluationCase(caseId: string): caseId is TemplateEvaluationCaseId {
  return Object.hasOwn(templateEvaluationCases, caseId);
}

export type SavedTemplateVersion = {
  id: string;
  templateId: string;
  version: number;
  status: string;
  bundle: unknown;
  attestations: unknown;
  publishedAt: Date | null;
};

/**
 * A template case's outcome from the template's saved versions. Only a version saved with its two
 * reviews counts.
 * - A published (or since withdrawn) version passes when the gate, run again at its publication
 *   time, still finds it eligible; if not, it is a critical false publication.
 * - A held version is not counted as passed: the case asks that an item hold only for a real
 *   unmet gate (and never, for example, for a missing statutory citation an original form does not
 *   need), and judging that needs an evaluator's decision on the recorded reasons.
 * - With no reviewed version the case has not run.
 */
export type TemplateCaseOutcome = {
  templateId: string;
  status: "case_pass" | "fail" | "needs_evaluator_decision" | "blocked";
  reason?: string;
  versionId?: string;
  version?: number;
  savedStatus?: string;
  decision?: "published" | "held";
  criticalFalsePublication?: boolean;
  reasons?: string[];
};
export function templateCaseOutcome(
  caseId: TemplateEvaluationCaseId,
  versions: SavedTemplateVersion[],
): TemplateCaseOutcome {
  const templateId = templateEvaluationCases[caseId];
  const reviewed = versions
    .filter((v) => v.templateId === templateId)
    .filter((v) => {
      const parsed = publicationSchema.safeParse(v.bundle);
      const reviews = (v.attestations as { reviews?: unknown } | null)?.reviews;
      return (
        parsed.success && parsed.data.reviews.length === 2 && Array.isArray(reviews) && reviews.length === 2
      );
    })
    .sort((a, b) => b.version - a.version);
  const latest = reviewed[0];
  if (!latest) return { templateId, status: "blocked", reason: `reviewed_pair_not_run:${templateId}` };
  const bundle = publicationSchema.parse(latest.bundle);
  const saved = { templateId, versionId: latest.id, version: latest.version, savedStatus: latest.status };
  if (latest.status === "published" || latest.status === "withdrawn") {
    // The publisher always records when it published; a row without that time cannot be checked.
    if (!latest.publishedAt)
      return { ...saved, status: "fail", reason: "published_without_publication_time" };
    const atPublication = evaluatePublication(bundle, latest.publishedAt);
    return atPublication.decision === "eligible"
      ? { ...saved, status: "case_pass", decision: "published" }
      : {
          ...saved,
          status: "fail",
          decision: "published",
          criticalFalsePublication: true,
          reasons: atPublication.reasons,
        };
  }
  if (latest.status === "held")
    return {
      ...saved,
      status: "needs_evaluator_decision",
      decision: "held",
      reasons: evaluatePublication(bundle).reasons,
    };
  return { ...saved, status: "blocked", reason: "reviewed_pair_outcome_pending" };
}
