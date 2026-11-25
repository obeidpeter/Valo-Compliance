import { pgTable, text, uuid, timestamp, index, check, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * An independent reviewer's decisions on the acceptance cases (decision 0016,
 * docs/architecture/reviewer-record.md): one row per decision, bound to the case's hash and, for a
 * run, to the run and the hash of the results it read. The database takes a row only from an active
 * reviewer and never changes or removes one; a later decision supersedes an earlier one by adding a row.
 */
export const valoAcceptanceReviews = pgTable(
  "valo_acceptance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpus: text("corpus").notNull(),
    caseId: text("case_id").notNull(),
    caseHash: text("case_hash").notNull(),
    judgment: text("judgment").notNull(),
    runId: text("run_id"),
    resultsHash: text("results_hash"),
    answer: text("answer").notNull(),
    reason: text("reason").notNull(),
    reviewer: text("reviewer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_acceptance_reviews_case").on(t.corpus, t.caseId, t.createdAt),
    check("valo_acceptance_reviews_corpus", sql`${t.corpus} IN ('editorial', 'checker', 'customer_ai')`),
    check("valo_acceptance_reviews_case_id", sql`${t.caseId} ~ '^[A-Z0-9][A-Z0-9-]{2,63}$'`),
    check("valo_acceptance_reviews_case_hash", sql`${t.caseHash} ~ '^[a-f0-9]{64}$'`),
    check("valo_acceptance_reviews_reason", sql`length(${t.reason}) BETWEEN 20 AND 2000`),
    check("valo_acceptance_reviews_reviewer", sql`length(${t.reviewer}) BETWEEN 1 AND 200`),
    // An expected outcome is confirmed or rejected; a run is met or not met, for one run and its results.
    // A null passes a check, so the run's fields are required outright.
    check(
      "valo_acceptance_reviews_judgment",
      sql`(${t.judgment} = 'expected_outcome' AND ${t.answer} IN ('confirmed', 'rejected')
          AND ${t.runId} IS NULL AND ${t.resultsHash} IS NULL)
        OR (${t.judgment} = 'run_outcome' AND ${t.answer} IN ('met', 'not_met')
          AND ${t.runId} IS NOT NULL AND ${t.resultsHash} IS NOT NULL
          AND length(${t.runId}) BETWEEN 1 AND 200 AND ${t.resultsHash} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);

/**
 * A suite's run kept for an independent reviewer (docs/architecture/reviewer-record.md, slice 2): every
 * case of the corpus with the suite's status for it, and for each case the suite cannot score itself,
 * what the reviewer reads, each with the hash a decision on it is bound to. A suite's command keeps a
 * run; the database dates it and never changes or removes one.
 */
export const valoAcceptanceRuns = pgTable(
  "valo_acceptance_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpus: text("corpus").notNull(),
    corpusHash: text("corpus_hash").notNull(),
    summary: jsonb("summary").notNull(),
    cases: jsonb("cases").notNull(),
    resultsHash: text("results_hash").notNull(),
    keptBy: text("kept_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_acceptance_runs_latest").on(t.corpus, t.createdAt),
    check("valo_acceptance_runs_corpus", sql`${t.corpus} IN ('editorial', 'checker', 'customer_ai')`),
    check("valo_acceptance_runs_corpus_hash", sql`${t.corpusHash} ~ '^[a-f0-9]{64}$'`),
    check("valo_acceptance_runs_results_hash", sql`${t.resultsHash} ~ '^[a-f0-9]{64}$'`),
    check("valo_acceptance_runs_kept_by", sql`${t.keptBy} ~ '^operator:[A-Za-z0-9._@-]{3,80}$'`),
    check(
      "valo_acceptance_runs_summary",
      sql`jsonb_typeof(${t.summary}) = 'array' AND jsonb_array_length(${t.summary}) <= 20`,
    ),
    check(
      "valo_acceptance_runs_cases",
      sql`jsonb_typeof(${t.cases}) = 'array' AND jsonb_array_length(${t.cases}) BETWEEN 1 AND 200
          AND octet_length(${t.cases}::text) <= 2000000`,
    ),
  ],
);
