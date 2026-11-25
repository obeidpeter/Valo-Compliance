import { digest } from "@workspace/valo-core";

/**
 * A suite's run as it is kept for an independent reviewer (decision 0016,
 * docs/architecture/reviewer-record.md, slice 2): every case of the corpus with the suite's own status
 * for it, and for each case the suite cannot score itself, what the reviewer reads. Nothing else keeps
 * a run where a staff request can read it: the editorial and customer suites write a file on the
 * machine that ran them, and the live check keeps its result only in memory. A kept run never
 * changes, so a decision on it is about the words the reviewer read.
 */
export type RunSection = { heading: string; lines: string[] };
export type KeptCase = {
  caseId: string;
  caseHash: string;
  /** The suite's own status for the case, in its words. */
  status: string;
  /** The suite's reason for that status, when it gives one. */
  reason: string | null;
  /** What the run left for a reviewer to judge, or null when it left nothing. */
  review: { sections: RunSection[] } | null;
  /**
   * Present, and true, only when the suite marks the case a critical failure: an editorial case's
   * critical false publication, or a scenario whose result breaks one of the corpus's conditions. A
   * case without it hashes as it did before the field existed.
   */
  critical?: true;
};
export type HashedKeptCase = KeptCase & { resultHash: string };

/** A kept case with the hash a decision on it is bound to: the SHA-256 of the case as kept. */
export const hashedKeptCase = (kept: KeptCase): HashedKeptCase => ({ ...kept, resultHash: digest(kept) });

const MAX_LINE = 2000;
const line = (value: unknown) => {
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/gu, " ").trim();
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
};
const lines = (values: unknown[]) => values.map(line).filter((value) => value.length > 0);
const section = (heading: string, values: unknown[]): RunSection[] => {
  const kept = lines(values);
  return kept.length ? [{ heading, lines: kept }] : [];
};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const list = (value: unknown) => (Array.isArray(value) ? value : []);

type EditorialReview = {
  role: string;
  model?: string;
  verdict: string;
  findings?: unknown[];
  missingEvidence?: unknown[];
};
/**
 * The editorial suite's results: a case it marks `needs_evaluator_decision` is left for a reviewer
 * with what its run kept, a held template's version with why it was held and its two reviews, or a
 * case-bound pair's two reviews. A case with nothing kept to read, such as C041 whose controlled
 * failure runs in CI, is listed with its reason and left with nothing to judge.
 */
export function editorialKeptCases(results: readonly Record<string, unknown>[]): KeptCase[] {
  return results.map((result) => {
    const status = String(result.status);
    const kept: KeptCase = {
      caseId: String(result.caseID),
      caseHash: String(result.caseHash),
      status,
      reason: text(result.reason),
      review: null,
      ...(result.criticalFalsePublication === true ? { critical: true as const } : {}),
    };
    const reviews = list(result.reviews) as EditorialReview[];
    if (status !== "needs_evaluator_decision" || reviews.length === 0) return kept;
    const reviewSections = reviews.flatMap((review) =>
      section(`The ${review.role} review${review.model ? ` (${review.model})` : ""}`, [
        `verdict: ${review.verdict}`,
        ...list(review.findings).map((finding) => `finding: ${line(finding)}`),
        ...list(review.missingEvidence).map((missing) => `missing evidence: ${line(missing)}`),
      ]),
    );
    const prerequisite = result.prerequisite as { caseId?: string; batchId?: string } | undefined;
    kept.review = {
      sections: result.templateId
        ? [
            ...section("What was held", [
              `template ${String(result.templateId)}, version ${String(result.version)}, saved as ${String(result.savedStatus)}`,
              `decision: ${String(result.decision)}`,
            ]),
            ...section("Why it was held", list(result.reasons)),
            ...reviewSections,
          ]
        : [
            ...section("The review pair", [
              `batch ${String(result.batchId)}`,
              `candidate ${String(result.candidateHash)}`,
            ]),
            ...(prerequisite?.caseId
              ? section("The case it follows", [
                  `${prerequisite.caseId}, batch ${String(prerequisite.batchId)}`,
                ])
              : []),
            ...reviewSections,
          ],
    };
    return kept;
  });
}

type LiveRun =
  | { caseId: string; ruleId: string | null; notReleased: true }
  | {
      caseId: string;
      title: string;
      ruleId: string;
      asOfDate: string;
      expected: { applicability: string; label: string };
      live:
        | {
            outcome: "result";
            label: string;
            reason: string;
            missingFacts: string[];
            sourceReviewHold: string | null;
            taskOffered: boolean;
          }
        | { outcome: "held"; hold: string }
        | { outcome: "refused"; reason: string };
      noteLabel: string | null;
      checks: Record<string, boolean>;
      matchesExpected: boolean;
      mapping: {
        translated: { fact: string; from: unknown; to: Record<string, unknown> }[];
        notAsked: string[];
        assumed: { answer: string; value: unknown; why: string }[];
      };
    };
type RecordedDifference = { live: string; source: "check" | "note"; why: string };

/**
 * The live check's runs of the 80 scenarios: a scenario whose result is not the corpus's expected
 * one, or whose result breaks one of the corpus's conditions, is left for a reviewer with the expected
 * result, the live result with its reasons, the research note's label, the difference as recorded with
 * why, and how the scenario's answers were put to the check.
 */
export function checkerKeptCases(
  runs: readonly LiveRun[],
  caseHashes: ReadonlyMap<string, string>,
  differences: Readonly<Record<string, RecordedDifference>>,
): KeptCase[] {
  return runs.map((run) => {
    const caseHash = caseHashes.get(run.caseId);
    if (!caseHash) throw new Error(`UNKNOWN_CHECKER_CASE:${run.caseId}`);
    if ("notReleased" in run)
      return {
        caseId: run.caseId,
        caseHash,
        status: "not_released",
        reason: `No released version of ${run.ruleId ?? "its rule"}.`,
        review: null,
      };
    const broken = Object.entries(run.checks)
      .filter(([, kept]) => !kept)
      .map(([name]) => name);
    const recorded = differences[run.caseId];
    const status = !run.matchesExpected
      ? "differs"
      : broken.length
        ? "condition_not_kept"
        : "matches_expected";
    if (status === "matches_expected")
      return { caseId: run.caseId, caseHash, status, reason: null, review: null };
    const live = run.live;
    return {
      caseId: run.caseId,
      caseHash,
      status,
      reason: recorded?.why ?? null,
      ...(status === "condition_not_kept" ? { critical: true as const } : {}),
      review: {
        sections: [
          ...section("The scenario", [run.title, `rule ${run.ruleId}, as of ${run.asOfDate}`]),
          ...section("Expected", [
            `applicability: ${run.expected.applicability}`,
            `result: ${run.expected.label}`,
          ]),
          ...section(
            "The live check",
            live.outcome === "result"
              ? [
                  `result: ${live.label}`,
                  `reason: ${live.reason}`,
                  ...live.missingFacts.map((fact) => `missing fact: ${fact}`),
                  ...(live.sourceReviewHold ? [`held for source review: ${live.sourceReviewHold}`] : []),
                  live.taskOffered ? "a task is offered" : "no task is offered",
                ]
              : live.outcome === "held"
                ? [`held: ${live.hold}`]
                : [`refused: ${live.reason}`],
          ),
          ...section("The research note", run.noteLabel ? [`result: ${run.noteLabel}`] : []),
          ...section(
            "The difference as recorded",
            recorded
              ? [
                  recorded.source === "check"
                    ? "whose result: the check's own"
                    : "whose result: the research note's, which the check repeats",
                  recorded.why,
                ]
              : [],
          ),
          ...section("Conditions not kept", broken),
          ...section("How the answers were put", [
            ...run.mapping.translated.map(
              (t) => `asked in other words: ${t.fact} (${line(t.from)}) as ${line(t.to)}`,
            ),
            ...run.mapping.notAsked.map((fact) => `not asked: ${fact}`),
            ...run.mapping.assumed.map((a) => `assumed: ${a.answer} = ${line(a.value)}, because ${a.why}`),
          ]),
        ],
      },
    };
  });
}

/** A customer answer as its draft keeps it: what the customer saw. */
export type CustomerAnswer = {
  title: string;
  content: {
    fields: Record<string, string>;
    blocks: { type: string; text: string; rows: string[][] }[];
  };
  limitations: string[];
};
type NumericCheck = { key: string; expected: string; actualKobo: string | null; pass: boolean };

/**
 * The customer AI suite's results: a case with an answer the provider wrote is left for a reviewer
 * with the answer as the customer saw it, its limitations, and the suite's own numeric checks, for the
 * reviewer to judge against the case's expected checks and rubric. The answers come only from the
 * suite's evaluation identity, whose drafts are synthetic.
 */
export function customerKeptCases(
  results: readonly Record<string, unknown>[],
  answers: ReadonlyMap<string, CustomerAnswer>,
): KeptCase[] {
  return results.map((result) => {
    const kept: KeptCase = {
      caseId: String(result.caseID),
      caseHash: String(result.caseHash),
      status: String(result.status),
      reason: text(result.reason),
      review: null,
    };
    const answer = typeof result.previewId === "string" ? answers.get(result.previewId) : undefined;
    if (!answer || result.previewStatus !== "ready") return kept;
    const fields = Object.entries(answer.content.fields).filter(([, value]) => value.trim());
    kept.review = {
      sections: [
        ...section("The answer", [
          answer.title,
          ...fields.map(([name, value]) => `${name}: ${value}`),
          ...answer.content.blocks.flatMap((block) =>
            block.type === "table" || block.type === "list"
              ? block.rows.map((row) => row.join(" | "))
              : [block.text],
          ),
        ]),
        ...section("Its limitations", answer.limitations),
        ...section(
          "The suite's numeric checks",
          (list(result.numericChecks) as NumericCheck[]).map(
            (check) =>
              `${check.key}: expected ${check.expected}, got ${check.actualKobo ?? "nothing"} kobo, ${check.pass ? "matches" : "does not match"}`,
          ),
        ),
      ],
    };
    return kept;
  });
}
