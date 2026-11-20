import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "./architecture-check";
import { readTestRecords, type TestRecord } from "./ci-evidence";

/**
 * Finds tests that no CI job runs to the end. A test may skip in one job, for example a database
 * test in the job without a database, as long as another job of the same run passes it. A test
 * that is skipped or a todo in every job that runs it proves nothing, so the evidence job fails
 * on it unless it is listed here with the reason it cannot run in CI.
 *
 * Scripts that CI never calls are listed in test-inventory.test.ts instead.
 */
export const SKIPPED_IN_CI: Record<string, string> = {
  "artifacts/api-server/src/modules/privacy/valo-erasure-hardening.integration.test.ts :: erasure holds, bounded recovery and accepted-upload process death > native private upload spans complete erasure and is removed by automatic maintenance":
    "needs native Replit App Storage; CI runs the portable storage lane, and test:valo-erasure-native-db runs this one on Replit",
  "artifacts/api-server/src/scripts/public-page-performance.test.ts :: public pages reach NFR-002's LCP target on an emulated mid-range phone":
    "a todo until hosted CI shows every server-rendered page within the LCP target (decision 0011, step 6)",
};

/** The key SKIPPED_IN_CI uses for a test: its file, then its name inside the tests it sits in. */
export const skipKey = (file: string, path: string[]) => `${file} :: ${path.join(" > ")}`;

/**
 * A recorded test file as a path in the repository. Each job checks the repository out in a
 * folder of its own, so the longest end of the recorded path that exists here is the file.
 */
export function repositoryPath(file: string, root = repositoryRoot): string {
  const parts = file.split("/").filter(Boolean);
  for (let start = 0; start < parts.length; start++) {
    const candidate = parts.slice(start).join("/");
    if (existsSync(join(root, candidate))) return candidate;
  }
  return file;
}

/** Every test that some job recorded and no job passed or failed: skipped or a todo everywhere. */
export function testsSkippedEverywhere(records: TestRecord[], root = repositoryRoot): string[] {
  const paths = new Map<string, string>();
  const outcomes = new Map<string, Set<TestRecord["status"]>>();
  for (const record of records) {
    if (!paths.has(record.file)) paths.set(record.file, repositoryPath(record.file, root));
    const key = skipKey(paths.get(record.file)!, record.path);
    outcomes.set(key, (outcomes.get(key) ?? new Set()).add(record.status));
  }
  return [...outcomes]
    .filter(([, statuses]) => !statuses.has("pass") && !statuses.has("fail"))
    .map(([key]) => key)
    .sort();
}

export function skippedTestProblems(
  records: TestRecord[],
  listed: Record<string, string> = SKIPPED_IN_CI,
  root = repositoryRoot,
): string[] {
  const skipped = new Set(testsSkippedEverywhere(records, root));
  const recorded = new Set(records.map((r) => skipKey(repositoryPath(r.file, root), r.path)));
  return [
    ...[...skipped]
      .filter((key) => !(key in listed))
      .map(
        (key) =>
          `${key}: skipped or a todo in every job that ran it. Run it where it can pass, or add it to SKIPPED_IN_CI with the reason it cannot.`,
      ),
    ...Object.keys(listed)
      .filter((key) => !skipped.has(key))
      .map(
        (key) =>
          `${key}: listed in SKIPPED_IN_CI but ${recorded.has(key) ? "a job ran it in this run" : "no job recorded it in this run"}; remove it from the list.`,
      ),
  ];
}

function main() {
  const records = readTestRecords(process.env.VALO_EVIDENCE_RESULTS_DIR ?? "");
  if (!records.length)
    throw Error("No test results found: set VALO_EVIDENCE_RESULTS_DIR to the collected results");
  const problems = skippedTestProblems(records);
  for (const problem of problems) process.stdout.write(`${problem}\n`);
  process.stdout.write(
    `skipped tests: ${problems.length} problem(s) among ${records.length} recorded tests\n`,
  );
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
