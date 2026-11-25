import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "../publication";

/**
 * The three frozen corpora an independent reviewer judges (decision 0016,
 * docs/architecture/reviewer-record.md), each case as the reviewer reads it and with the hash the
 * suites bind it by: the SHA-256 of the case's row as key-sorted JSON.
 */
export const acceptanceCorpora = ["editorial", "checker", "customer_ai"] as const;
export type AcceptanceCorpus = (typeof acceptanceCorpora)[number];
export const isAcceptanceCorpus = (value: unknown): value is AcceptanceCorpus =>
  (acceptanceCorpora as readonly unknown[]).includes(value);

const files: Record<AcceptanceCorpus, string> = {
  editorial: "docs/evaluation-candidates/editorial.json",
  checker: "docs/evaluation-candidates/checker.json",
  customer_ai: "docs/evaluation-candidates/customer-ai.json",
};

export type AcceptanceCase = {
  id: string;
  hash: string;
  title: string;
  expected: string[];
  critical: string[];
  sources: string[];
};

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
const strings = (value: unknown) =>
  Array.isArray(value) ? value.map(text) : value === null || value === undefined ? [] : [text(value)];
/** An object's fields as "name: value" lines, leaving out the empty ones. */
const fields = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
        .filter(([, field]) => field !== null && field !== undefined)
        .map(([name, field]) => `${name}: ${text(field)}`)
    : [];

const shapes: Record<AcceptanceCorpus, (row: Row) => Omit<AcceptanceCase, "hash">> = {
  editorial: (row) => {
    const outcome = (row.expectedOutcome ?? {}) as Row;
    return {
      id: String(row.id),
      title: text(row.scenario),
      expected: [`decision: ${text(outcome.decision)}`, ...strings(outcome.requiredBehavior)],
      critical: strings(row.criticalFailureConditions),
      sources: [...strings(row.sourceCandidate), ...strings(row.sourceRequirementIDs)],
    };
  },
  checker: (row) => ({
    id: String(row.caseID),
    title: text(row.title),
    expected: [...fields(row.expectedOutcomeCandidate), ...strings(row.expectedReasonChecks)],
    critical: strings(row.criticalFailureConditions),
    sources: [...strings(row.sourceCandidateID), ...strings(row.requirementIDs)],
  }),
  customer_ai: (row) => ({
    id: String(row.caseID),
    title: `${text(row.task)} · ${text(row.category)}: ${text(row.userInput)}`,
    expected: [...strings(row.expectedChecks), ...fields(row.expectedNumeric), ...strings(row.numericRubric)],
    critical: strings(row.criticalFailureConditions),
    sources: strings(row.sourceRequirementIDs),
  }),
};

const read = (path: string) => readFileSync(resolve(publicationWorkspaceRoot(), path), "utf8");
const cache = new Map<AcceptanceCorpus, AcceptanceCase[]>();
/** A corpus's cases, read once: the corpora are frozen. `readFile` is for tests. */
export function corpusCases(corpus: AcceptanceCorpus, readFile: (path: string) => string = read) {
  const known = readFile === read ? cache.get(corpus) : undefined;
  if (known) return known;
  const rows = (JSON.parse(readFile(files[corpus])) as { cases: Row[] }).cases;
  const cases = rows.map((row) => ({ ...shapes[corpus](row), hash: digest(row) }));
  if (readFile === read) cache.set(corpus, cases);
  return cases;
}

/** What a confirmation claims (decision 0016, point 5). The owner confirms the wording. */
export const confirmationClaim =
  "This confirms that the case's expected outcome follows from its cited sources. It is not legal, tax or regulatory advice unless the reviewer is engaged to give that.";
