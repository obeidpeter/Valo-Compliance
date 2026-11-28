import { relative } from "node:path";

/**
 * OPS-008 (docs/architecture/rollback.md): which failures of the previous release's database job, run
 * against this schema, are expected.
 *
 * A test of the previous release can fail on a newer schema by design, in two ways that are not what
 * the release does: what it checks is the schema itself (a list of the tables that hold a workspace's
 * rows, for example, which a new table lengthens); or it sets itself up by writing rows straight into
 * the database in a shape the release's own code never writes, which a guard the new schema adds
 * refuses (an order its price does not describe, for example). Each such failure is recorded in
 * lib/db/rollback-expected-failures.json with the migrations that cause it and why the previous release
 * still runs, and is read only while one of those migrations is new to the previous release. Any other
 * failure fails the job.
 */
export const EXPECTED_FAILURES = "lib/db/rollback-expected-failures.json";

/** The tests of one file that fail for one reason: each by its full name, as its path of names. */
export type ExpectedFailure = { migrations: string[]; file: string; tests: string[][]; reason: string };
/** One line of the test results reporter (test-results-reporter.mjs). */
export type TestRecord = { file: string; path: string[]; status: string };
export type FailedTest = { file: string; path: string[] };
export type StepOutcome = { name: string; run: string; code: number; failed: FailedTest[] };

/** The previous release's own check that the tests its evidence register cites passed. */
const EVIDENCE_CHECK = /\bvalo:ci-evidence --job postgres\b/;

const same = (a: FailedTest, b: FailedTest) =>
  a.file === b.file && a.path.length === b.path.length && a.path.every((name, i) => b.path[i] === name);

/**
 * The tests that failed in a step's records, each named by its file within the previous release's
 * checkout and its full name. A test whose own subtest failed is judged by that subtest.
 */
export function failedTests(records: readonly TestRecord[], checkout: string): FailedTest[] {
  const failed = records
    .filter((record) => record.status === "fail")
    .map((record) => ({ file: relative(checkout, record.file).replaceAll("\\", "/"), path: record.path }));
  const inner = failed.filter(
    (test) =>
      !failed.some(
        (other) =>
          other.file === test.file &&
          other.path.length > test.path.length &&
          test.path.every((name, i) => other.path[i] === name),
      ),
  );
  return inner.filter((test, i) => inner.findIndex((other) => same(other, test)) === i);
}

/**
 * The register's entries that apply to this run: those with a migration this release has and the
 * previous one lacks. An entry that is not well formed, or names a migration this release does not
 * have, is a mistake in the register.
 */
export function applicableFailures(
  register: unknown,
  currentMigrations: readonly string[],
  previousMigrations: readonly string[],
): ExpectedFailure[] {
  const entries = (register as { failures?: unknown }).failures;
  if (!Array.isArray(entries)) throw Error("ROLLBACK_EXPECTED_FAILURES_INVALID: no list of failures");
  const found: ExpectedFailure[] = [];
  for (const entry of entries as Partial<ExpectedFailure>[]) {
    if (
      !Array.isArray(entry.migrations) ||
      !entry.migrations.length ||
      !entry.migrations.every((tag) => typeof tag === "string") ||
      typeof entry.file !== "string" ||
      !/^[a-z0-9][a-z0-9/._-]*\.test\.(ts|mjs)$/.test(entry.file) ||
      !Array.isArray(entry.tests) ||
      !entry.tests.length ||
      !entry.tests.every(
        (path) =>
          Array.isArray(path) &&
          path.length > 0 &&
          path.every((name) => typeof name === "string" && name.length > 0),
      ) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 40
    )
      throw Error(`ROLLBACK_EXPECTED_FAILURES_INVALID: ${JSON.stringify(entry).slice(0, 120)}`);
    const unknown = entry.migrations.filter((tag) => !currentMigrations.includes(tag));
    if (unknown.length)
      throw Error(
        `ROLLBACK_EXPECTED_FAILURES_INVALID: ${unknown.join(", ")} is not a migration of this release`,
      );
    if (entry.migrations.some((tag) => !previousMigrations.includes(tag)))
      found.push(entry as ExpectedFailure);
  }
  return found;
}

/**
 * Whether the previous release still runs on this schema. Each failed step is explained only when
 * tests failed in it and every one of them is expected; the previous release's check of its evidence
 * register is explained when the only tests that failed in the whole run are expected ones. An
 * expected test that did not fail is itself a mistake: the register says something untrue.
 */
export function judgeSteps(steps: readonly StepOutcome[], expected: readonly ExpectedFailure[]) {
  const listed: FailedTest[] = expected.flatMap((entry) =>
    entry.tests.map((path) => ({ file: entry.file, path })),
  );
  const isExpected = (test: FailedTest) => listed.some((one) => same(one, test));
  const all = steps.flatMap((step) => step.failed);
  const onlyExpected = all.length > 0 && all.every(isExpected);
  const failedSteps = steps
    .filter((step) => step.code !== 0)
    .map((step) => {
      const unexpected = step.failed.filter((test) => !isExpected(test));
      const explained =
        (step.failed.length > 0 && unexpected.length === 0) ||
        (step.failed.length === 0 && EVIDENCE_CHECK.test(step.run) && onlyExpected);
      return { name: step.name, explained, expected: step.failed.length - unexpected.length, unexpected };
    });
  const unused = listed.filter((one) => !all.some((test) => same(one, test)));
  return {
    steps: failedSteps,
    unused,
    passed: failedSteps.every((step) => step.explained) && unused.length === 0,
  };
}
