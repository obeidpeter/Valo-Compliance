import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "./architecture-check";
import { COVERAGE_AREAS, NFR_011_MINIMUM_BRANCH_PERCENT, type CoverageAreaName } from "./code-coverage-areas";

/**
 * NFR-011's coverage report. Runs an area's tests (code-coverage-areas.ts) in one Node test run with
 * Node's built-in coverage limited to the area's source files, so Node itself merges what every
 * test file covered, and reports branch, line and function coverage as Node measures them. That
 * is V8 block coverage: a branch V8 never saw counts once, so a function no test calls is one
 * uncovered branch however many branches it has. A source file no test loads cannot be measured
 * and fails the run. In CI the database job runs each area, and the summary goes to the job's
 * test results for the evidence job.
 */
export const RUNNER_PACKAGE = "artifacts/api-server";
export const MEASURED_BY =
  "node --test --experimental-test-coverage (V8 block coverage, merged across the area's test files)";
const reporter = fileURLToPath(new URL("./test-results-reporter.mjs", import.meta.url));

type Count = [covered: number, total: number];
export type FileCoverage = { path: string; lines: Count; branches: Count; functions: Count };
export type AreaCoverage = {
  area: string;
  measuredBy: string;
  branches: Count;
  lines: Count;
  functions: Count;
  files: FileCoverage[];
  notLoaded: string[];
};

export function percent([covered, total]: Count) {
  return total === 0 ? 100 : Math.floor((covered / total) * 10000) / 100;
}

/** The area's totals from one run's coverage, by repository path. */
export function summarize(
  area: string,
  sources: string[],
  measured: FileCoverage[],
  root = repositoryRoot,
): AreaCoverage {
  const byPath = new Map(measured.map((f) => [relative(root, f.path), f]));
  const files = sources.flatMap((source) => {
    const file = byPath.get(source);
    return file ? [{ ...file, path: source }] : [];
  });
  const total = (key: "lines" | "branches" | "functions"): Count =>
    files.reduce<Count>(([c, t], f) => [c + f[key][0], t + f[key][1]], [0, 0]);
  return {
    area,
    measuredBy: MEASURED_BY,
    branches: total("branches"),
    lines: total("lines"),
    functions: total("functions"),
    files,
    notLoaded: sources.filter((source) => !byPath.has(source)),
  };
}

export function coverageProblems(summary: AreaCoverage, minimumBranchPercent?: number): string[] {
  const problems = summary.notLoaded.map((s) => `${s}: no test of the ${summary.area} area loads it`);
  if (minimumBranchPercent !== undefined && percent(summary.branches) < minimumBranchPercent)
    problems.push(
      `${summary.area}: branch coverage ${percent(summary.branches)}% is below ${minimumBranchPercent}%`,
    );
  return problems;
}

export type CoverageRun = {
  area: string;
  sources: string[];
  tests: string[];
  /** Where the tests run from; test paths are given relative to it. */
  cwd: string;
  /** Node options that load the code, before the test flags (tsx for TypeScript). */
  loader: string[];
  env: Record<string, string>;
  resultsDirectory: string;
  root?: string;
};

/** Runs the tests once with coverage on and returns the test run's exit status and the area's
 * coverage, which the results reporter recorded for this run. */
export function runCoverage(options: CoverageRun): { status: number | null; summary: AreaCoverage } {
  const root = options.root ?? repositoryRoot;
  const run = randomUUID();
  mkdirSync(options.resultsDirectory, { recursive: true });
  const inherited = process.env.NODE_OPTIONS ?? "";
  // In CI the job's NODE_OPTIONS already load the results reporter; elsewhere add it.
  const nodeOptions = inherited.includes("test-results-reporter.mjs")
    ? inherited
    : [
        inherited,
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        `--test-reporter=${reporter}`,
        `--test-reporter-destination=${join(options.resultsDirectory, "reporter-output.txt")}`,
      ]
        .filter(Boolean)
        .join(" ");
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.env,
    NODE_OPTIONS: nodeOptions,
    VALO_TEST_RESULTS_DIR: options.resultsDirectory,
    VALO_COVERAGE_AREA: options.area,
    VALO_COVERAGE_RUN: run,
  };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(
    process.execPath,
    [
      ...options.loader,
      "--experimental-test-coverage",
      ...options.sources.map((source) => `--test-coverage-include=${join(root, source)}`),
      "--test-concurrency=1",
      "--test",
      ...options.tests.map((test) => relative(options.cwd, join(root, test))),
    ],
    { cwd: options.cwd, env, stdio: "inherit" },
  );
  const recorded = readdirSync(options.resultsDirectory)
    .filter((name) => name.endsWith(".coverage.json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(options.resultsDirectory, name), "utf8")) as {
          run: string | null;
          files: FileCoverage[];
        },
    )
    .filter((r) => r.run === run)
    .flatMap((r) => r.files);
  return { status: child.status, summary: summarize(options.area, options.sources, recorded, root) };
}

/** Runs one NFR-011 area as CI's database job does. */
export function runArea(area: CoverageAreaName, resultsDirectory: string) {
  const definition = COVERAGE_AREAS[area];
  return runCoverage({
    area,
    sources: definition.sources,
    tests: definition.tests,
    cwd: join(repositoryRoot, RUNNER_PACKAGE),
    loader: ["--import", "tsx", "--experimental-test-module-mocks"],
    // The opt-ins the area's database tests need, as their own package scripts set them.
    env: {
      NODE_ENV: "development",
      VALO_RUN_DB_TESTS: "synthetic-development-only",
      VALO_RUN_DISPUTE_TESTS: "synthetic-development-only",
      VALO_RUN_STAFF_ROLE_TESTS: "synthetic-development-only",
    },
    resultsDirectory,
  });
}

/** The area summaries the database job wrote, wherever they sit under the results folder. */
export function readAreaCoverage(directory: string): AreaCoverage[] {
  const found: AreaCoverage[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^code-coverage-[a-z]+\.json$/.test(entry.name))
        found.push(JSON.parse(readFileSync(path, "utf8")) as AreaCoverage);
    }
  };
  if (existsSync(directory)) walk(directory);
  return found.sort((a, b) => a.area.localeCompare(b.area));
}

/** NFR-011's part of the readiness report. */
export function coverageReport(areas: AreaCoverage[]) {
  return {
    requirement: "NFR-011",
    minimumBranchPercent: NFR_011_MINIMUM_BRANCH_PERCENT,
    measuredBy: MEASURED_BY,
    areas: areas.map((a) => ({
      area: a.area,
      branchPercent: percent(a.branches),
      linePercent: percent(a.lines),
      functionPercent: percent(a.functions),
      branches: a.branches,
      notLoaded: a.notLoaded,
      meetsMinimum: coverageProblems(a, NFR_011_MINIMUM_BRANCH_PERCENT).length === 0,
    })),
  };
}

export function coverageTable(summary: AreaCoverage) {
  const row = (name: string, f: { lines: Count; branches: Count; functions: Count }) =>
    `| ${name} | ${percent(f.branches)}% (${f.branches[0]}/${f.branches[1]}) | ${percent(f.lines)}% | ${percent(f.functions)}% |`;
  return [
    `### ${summary.area}`,
    "",
    "| File | Branches | Lines | Functions |",
    "| --- | --- | --- | --- |",
    ...summary.files.map((f) => row(f.path, f)),
    row("**All files**", summary),
    ...summary.notLoaded.map((s) => `| ${s} | not loaded by any test | | |`),
  ].join("\n");
}

function main(args: string[]) {
  const area = args[0] as CoverageAreaName;
  if (!(area in COVERAGE_AREAS))
    throw Error(`usage: code-coverage.ts <${Object.keys(COVERAGE_AREAS).join("|")}> [--minimum]`);
  const minimum = args.includes("--minimum") ? NFR_011_MINIMUM_BRANCH_PERCENT : undefined;
  const resultsDirectory = process.env.VALO_TEST_RESULTS_DIR ?? mkdtempSync(join(tmpdir(), "valo-coverage-"));
  const { status, summary } = runArea(area, resultsDirectory);
  writeFileSync(
    join(resultsDirectory, `code-coverage-${area}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(`\n${coverageTable(summary)}\n\n${summary.measuredBy}\n`);
  const problems = coverageProblems(summary, minimum);
  if (status !== 0) problems.unshift(`${area}: the area's tests failed (exit status ${status})`);
  for (const problem of problems) process.stdout.write(`${problem}\n`);
  process.stdout.write(`coverage of ${area}: ${problems.length} problem(s)\n`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2));
