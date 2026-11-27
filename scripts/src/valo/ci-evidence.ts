import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { requirements } from "@workspace/valo-records";
import { repositoryRoot } from "./architecture-check";
import { coverageTable, MEASURED_BY, readAreaCoverage } from "./code-coverage";
import { WORKFLOW } from "./database-tests";
import { currentResultFiles, resultArtifactName } from "./result-attempts";

/**
 * Requirement evidence recorded in CI (decision 0010). The register cites a test by its file
 * and exact top-level name, the CI job that runs it, the requirement and what the test shows.
 * Each CI job records how its tests ended (test-results-reporter.mjs) and fails when a test
 * cited for it did not pass; the evidence job collects every job's results for the readiness
 * report. Evidence never accepts a requirement: acceptance needs the evidence and approvals
 * the specification names.
 */
export const CI_EVIDENCE_REGISTER = "docs/registers/ci-evidence.json";

const FIELDS = ["requirement", "job", "file", "test", "proves"] as const;
export type Citation = Record<(typeof FIELDS)[number], string>;
export type TestRecord = {
  file: string;
  path: string[];
  status: "pass" | "fail" | "skip" | "todo";
  kind: string;
};
export type CitationResult = "pass" | "fail" | "not_run";

export function readCitations(root = repositoryRoot): Citation[] {
  const register = JSON.parse(readFileSync(join(root, CI_EVIDENCE_REGISTER), "utf8")) as {
    citations?: unknown;
  };
  if (!Array.isArray(register.citations)) throw Error("CI_EVIDENCE_REGISTER_INVALID: no citations list");
  return register.citations.map((citation: unknown, index) => {
    const fields = citation && typeof citation === "object" ? (citation as Record<string, unknown>) : {};
    const keys = Object.keys(fields).sort().join();
    if (
      keys !== [...FIELDS].sort().join() ||
      FIELDS.some((field) => typeof fields[field] !== "string" || !(fields[field] as string).trim())
    )
      throw Error(`CI_EVIDENCE_REGISTER_INVALID: citation ${index + 1} needs exactly ${FIELDS.join(", ")}`);
    return fields as Citation;
  });
}

export function workflowJobs(root = repositoryRoot): Set<string> {
  const workflow = parse(readFileSync(join(root, WORKFLOW), "utf8")) as { jobs?: Record<string, unknown> };
  return new Set(Object.keys(workflow.jobs ?? {}));
}

/**
 * The names a test file builds from a template, such as test(`${fixture.id}: ${fixture.name}`),
 * as patterns in which each placeholder stands for any text and the rest must match exactly. A
 * reviewer finds such a test by its fixed words; the job's own check still requires a test of
 * exactly the cited name to have run and passed.
 */
export function generatedTestNames(source: string): RegExp[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(/\btest\(\s*`((?:[^`\\]|\\.)*)`/g)]
    .map((match) => match[1]!)
    .filter((template) => template.includes("${"))
    .map(
      (template) =>
        new RegExp(
          `^${template
            .split(/\$\{[^}]*\}/)
            .map(escape)
            .join(".+")}$`,
        ),
    );
}

/**
 * Whether a file names a test only as a subtest (`t.test("…")`), never as a top-level `test("…")`.
 * The job's check finds a citation by the top-level name of each test that ran (citationResult), so
 * a cited subtest is never found there.
 */
export function namedOnlyAsSubtest(source: string, name: string): boolean {
  const quoted = `(['"\`])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`;
  const asSubtest = new RegExp(`\\.test\\(\\s*${quoted}`).test(source);
  const asTopLevel = new RegExp(`(?<![.\\w])test\\(\\s*${quoted}`).test(source);
  return asSubtest && !asTopLevel;
}

/** What a reviewer can check without running anything: every citation names a requirement,
 * a CI job, an existing test file and a test with exactly that name, once. A name the file builds
 * from a template must fit the template (generatedTestNames). */
export function citationProblems(
  citations: Citation[],
  root = repositoryRoot,
  requirementIds: ReadonlySet<string> = new Set(requirements.map((r) => r.id)),
  jobs: ReadonlySet<string> = workflowJobs(root),
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    const label = `${c.requirement} "${c.test}"`;
    if (!requirementIds.has(c.requirement)) problems.push(`${label}: no requirement ${c.requirement}`);
    if (!jobs.has(c.job)) problems.push(`${label}: no job ${c.job} in ${WORKFLOW}`);
    const path = join(root, c.file);
    if (!/\.test\.(ts|tsx|mjs|js)$/.test(c.file) || !existsSync(path))
      problems.push(`${label}: no test file ${c.file}`);
    else {
      const source = readFileSync(path, "utf8");
      if (
        !['"', "'", "`"].some((quote) => source.includes(`${quote}${c.test}${quote}`)) &&
        !generatedTestNames(source).some((name) => name.test(c.test))
      )
        problems.push(`${label}: ${c.file} names no test exactly like this`);
      else if (namedOnlyAsSubtest(source, c.test))
        problems.push(
          `${label}: ${c.file} names this as a subtest; cite its top-level test, the only name the job's check reads`,
        );
    }
    const key = `${c.requirement}\0${c.file}\0${c.test}`;
    if (seen.has(key)) problems.push(`${label}: cited twice for ${c.requirement}`);
    seen.add(key);
  }
  return problems;
}

export const EVIDENCE_JOB = "evidence";

type WorkflowStep = { run?: unknown; uses?: unknown; with?: Record<string, unknown> };
type WorkflowJob = { needs?: string | string[]; env?: Record<string, unknown>; steps?: WorkflowStep[] };

/**
 * CI must record results in, check the citations of, and upload the results of every job the
 * register names, and the evidence job must wait for those jobs and check every citation. A job
 * records through NODE_OPTIONS in its own env: the runner refuses NODE_OPTIONS written to
 * $GITHUB_ENV, so no step may try.
 */
export function workflowProblems(citations: Citation[], root = repositoryRoot): string[] {
  const workflow = parse(readFileSync(join(root, WORKFLOW), "utf8")) as {
    jobs?: Record<string, WorkflowJob>;
  };
  const jobs = workflow.jobs ?? {};
  const runs = (job: string) =>
    (jobs[job]?.steps ?? []).map((step) => (typeof step.run === "string" ? step.run : ""));
  const uploads = (job: string, artifact: string) =>
    (jobs[job]?.steps ?? []).some(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/upload-artifact@") &&
        step.with?.name === artifact,
    );
  const problems: string[] = [];
  const cited = [...new Set(citations.map((c) => c.job))].sort();
  for (const job of cited) {
    const env = jobs[job]?.env ?? {};
    if (
      typeof env.VALO_TEST_RESULTS_DIR !== "string" ||
      typeof env.NODE_OPTIONS !== "string" ||
      !env.NODE_OPTIONS.includes("test-results-reporter.mjs")
    )
      problems.push(
        `job ${job} does not record its test results: its env needs VALO_TEST_RESULTS_DIR and NODE_OPTIONS loading test-results-reporter.mjs`,
      );
    if (!runs(job).some((run) => run.includes(`valo:ci-evidence --job ${job}`)))
      problems.push(`job ${job} does not check the tests cited for it (valo:ci-evidence --job ${job})`);
    if (!uploads(job, resultArtifactName(job)))
      problems.push(`job ${job} does not upload ${resultArtifactName(job)}`);
  }
  const needs = [jobs[EVIDENCE_JOB]?.needs ?? []].flat();
  for (const job of cited)
    if (!needs.includes(job)) problems.push(`the ${EVIDENCE_JOB} job does not wait for the ${job} job`);
  if (!runs(EVIDENCE_JOB).some((run) => run.includes("valo:ci-evidence --all")))
    problems.push(`the ${EVIDENCE_JOB} job does not check every citation (valo:ci-evidence --all)`);
  for (const job of Object.keys(jobs))
    if (runs(job).some((run) => /\bNODE_OPTIONS=[^\n]*>>\s*"?\$GITHUB_ENV/.test(run)))
      problems.push(
        `job ${job} writes NODE_OPTIONS to $GITHUB_ENV, which the runner ignores; set it in the job's env`,
      );
  return problems;
}

/** The test records under `directory`, from each job's latest attempt (result-attempts.ts). */
export function readTestRecords(directory: string): TestRecord[] {
  const records: TestRecord[] = [];
  for (const path of currentResultFiles(directory, (name) => name.endsWith(".jsonl")))
    for (const line of readFileSync(path, "utf8").split("\n"))
      if (line) records.push(JSON.parse(line) as TestRecord);
  return records;
}

/**
 * pass only when the cited test ran, passed, and neither it nor any test inside it failed, was
 * skipped or is a todo, wherever the job ran it. A test that never ran, or only partly, is
 * not_run; checkouts differ between machines, so a record matches by the end of its path.
 */
export function citationResult(citation: Citation, records: TestRecord[]): CitationResult {
  const runs = records.filter((r) => {
    const file = r.file.replaceAll("\\", "/");
    return (file === citation.file || file.endsWith(`/${citation.file}`)) && r.path[0] === citation.test;
  });
  if (runs.some((r) => r.status === "fail")) return "fail";
  if (!runs.some((r) => r.path.length === 1) || runs.some((r) => r.status !== "pass")) return "not_run";
  return "pass";
}

export function jobProblems(job: string, citations: Citation[], records: TestRecord[]): string[] {
  return citations
    .filter((c) => c.job === job)
    .flatMap((c) => {
      const result = citationResult(c, records);
      if (result === "pass") return [];
      const why =
        result === "fail" ? "failed" : "did not pass here: it did not run, was skipped or has a skipped test";
      return [`${c.requirement} "${c.test}" (${c.file}) ${why}`];
    });
}

/** The register's citations as readiness evidence entries, by requirement. */
export function evidenceByRequirement(
  citations: Citation[],
  records: TestRecord[] | undefined,
  root = repositoryRoot,
) {
  const byRequirement = new Map<string, object[]>();
  for (const c of citations) {
    const entry = {
      kind: "test" as const,
      path: c.file,
      hash: createHash("sha256")
        .update(readFileSync(join(root, c.file)))
        .digest("hex"),
      result: records ? citationResult(c, records) : ("not_run" as const),
      test: c.test,
      job: c.job,
      proves: c.proves,
      recordedBy: "ci",
    };
    byRequirement.set(c.requirement, [...(byRequirement.get(c.requirement) ?? []), entry]);
  }
  return byRequirement;
}

function summaryTable(citations: Citation[], records: TestRecord[]) {
  const rows = citations.map((c) => {
    const result = citationResult(c, records);
    return `| ${c.requirement} | ${result} | ${c.job} | ${c.test.replaceAll("|", "\\|")} | ${c.proves.replaceAll("|", "\\|")} |`;
  });
  return ["| Requirement | Result | Job | Test | Shows |", "| --- | --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

function main(args: string[]) {
  const citations = readCitations();
  const problems = [...citationProblems(citations), ...workflowProblems(citations)];
  const job = args[args.indexOf("--job") + 1];
  let records: TestRecord[] = [];
  if (args.includes("--job") && job) {
    records = readTestRecords(process.env.VALO_TEST_RESULTS_DIR ?? "");
    problems.push(...jobProblems(job, citations, records));
  } else if (args.includes("--all")) {
    records = readTestRecords(process.env.VALO_EVIDENCE_RESULTS_DIR ?? "");
    for (const name of workflowJobs()) problems.push(...jobProblems(name, citations, records));
    const coverage = readAreaCoverage(process.env.VALO_EVIDENCE_RESULTS_DIR ?? "");
    const summary = [
      `## Requirement evidence from this run\n\n${summaryTable(citations, records)}\n`,
      ...(coverage.length
        ? [
            `## NFR-011 coverage from this run\n\nMeasured by ${MEASURED_BY}.\n`,
            ...coverage.map(coverageTable),
          ]
        : []),
    ].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
  } else throw Error("usage: ci-evidence.ts --job <job> | --all");
  for (const problem of problems) process.stdout.write(`${problem}\n`);
  process.stdout.write(`requirement evidence: ${problems.length} problem(s)\n`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2));
