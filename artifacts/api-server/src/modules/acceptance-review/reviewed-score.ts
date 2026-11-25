import { digest } from "@workspace/valo-core";
import type { AcceptanceCorpus } from "./acceptance-cases";
import type { HashedKeptCase } from "./kept-runs";

/**
 * A kept run scored with the reviewer's record (decision 0016, docs/architecture/reviewer-record.md,
 * slice 3). A case counts only when its expected outcome is confirmed for the case's hash, and, where
 * the suite cannot score the run itself, the run is recorded as met for the case as kept. A rejected
 * expected outcome takes the case out of the score. The score names every row of the record it used,
 * and accepts nothing: accepting a requirement stays the owner's decision.
 */
export type RecordRow = {
  id: string;
  judgment: "expected_outcome" | "run_outcome";
  caseId: string;
  caseHash: string;
  runId: string | null;
  resultsHash: string | null;
  answer: "confirmed" | "rejected" | "met" | "not_met";
  reason: string;
  reviewer: string;
  createdAt: string;
};

/** The statuses with which each suite passes a case it scores by itself. */
export const suitePasses: Record<AcceptanceCorpus, readonly string[]> = {
  editorial: ["control_pass", "case_pass"],
  checker: ["matches_expected"],
  customer_ai: ["control_pass"],
};

/**
 * How many scored cases each requirement asks to count: EDP-010 and AI-008 ask for at least 95%;
 * RUL-008 asks that all critical results and exclusions pass, so every scored scenario must count.
 */
export const requiredToCount = (corpus: AcceptanceCorpus, scored: number) =>
  corpus === "checker" ? scored : Math.ceil(scored * 0.95);

export type CaseScore = {
  caseId: string;
  outcome: "counted" | "not_counted" | "excluded";
  /** Why, in a few words. */
  because:
    | "confirmed_and_passed_by_the_suite"
    | "confirmed_and_met_in_this_run"
    | "expected_outcome_rejected"
    | "expected_outcome_not_confirmed"
    | "not_passed_by_the_suite"
    | "run_not_recorded_as_met"
    | "run_recorded_as_not_met";
  critical: boolean;
  /** The ids of the record's rows this case's outcome rests on. */
  rows: string[];
};

const newer = (a: RecordRow, b: RecordRow) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
function latest(rows: RecordRow[], key: (row: RecordRow) => string) {
  const found = new Map<string, RecordRow>();
  for (const row of rows) {
    const k = key(row);
    const held = found.get(k);
    if (!held || newer(row, held) > 0) found.set(k, row);
  }
  return found;
}

/** A kept run's cases scored with the record's rows. */
export function scoreKeptRun(
  corpus: AcceptanceCorpus,
  run: { id: string; resultsHash: string; cases: readonly HashedKeptCase[] },
  rows: readonly RecordRow[],
) {
  // Only the latest decision on each case's own hash, and on this run's case as kept, is read.
  const expected = latest(
    rows.filter((row) => row.judgment === "expected_outcome"),
    (row) => `${row.caseId} ${row.caseHash}`,
  );
  const outcomes = latest(
    rows.filter((row) => row.judgment === "run_outcome" && row.runId === run.id),
    (row) => `${row.caseId} ${row.caseHash} ${String(row.resultsHash)}`,
  );
  const cases: CaseScore[] = run.cases.map((kept) => {
    const critical = kept.critical === true;
    const decided = expected.get(`${kept.caseId} ${kept.caseHash}`);
    const score = (
      outcome: CaseScore["outcome"],
      because: CaseScore["because"],
      used: (RecordRow | undefined)[],
    ): CaseScore => ({
      caseId: kept.caseId,
      outcome,
      because,
      critical,
      rows: used.flatMap((row) => (row ? [row.id] : [])),
    });
    if (decided?.answer === "rejected") return score("excluded", "expected_outcome_rejected", [decided]);
    if (decided?.answer !== "confirmed") return score("not_counted", "expected_outcome_not_confirmed", []);
    if (kept.review) {
      const met = outcomes.get(`${kept.caseId} ${kept.caseHash} ${kept.resultHash}`);
      if (met?.answer === "met") return score("counted", "confirmed_and_met_in_this_run", [decided, met]);
      return met
        ? score("not_counted", "run_recorded_as_not_met", [decided, met])
        : score("not_counted", "run_not_recorded_as_met", [decided]);
    }
    return suitePasses[corpus].includes(kept.status)
      ? score("counted", "confirmed_and_passed_by_the_suite", [decided])
      : score("not_counted", "not_passed_by_the_suite", [decided]);
  });
  const used = new Set(cases.flatMap((c) => c.rows));
  const record = rows
    .filter((row) => used.has(row.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({ ...row, hash: digest(row) }));
  const excluded = cases.filter((c) => c.outcome === "excluded").length;
  const scored = cases.length - excluded;
  const counted = cases.filter((c) => c.outcome === "counted").length;
  const critical = cases.filter((c) => c.critical).length;
  const required = requiredToCount(corpus, scored);
  return {
    corpus,
    run: { id: run.id, resultsHash: run.resultsHash },
    cases: cases.length,
    excluded,
    scored,
    counted,
    notCounted: scored - counted,
    required,
    critical,
    /** Whether the counted cases reach the requirement's bar with no critical failure. Not acceptance. */
    meetsBar: scored > 0 && counted >= required && critical === 0,
    accepted: false as const,
    byCase: cases,
    /** Every row of the record the score used, each with the hash of the row as read. */
    rows: record.map(({ id, hash }) => ({ id, hash })),
    recordHash: digest(record),
    record,
  };
}
export type ReviewedScore = ReturnType<typeof scoreKeptRun>;
