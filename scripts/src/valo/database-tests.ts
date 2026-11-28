import { execFileSync, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";
import {
  EXPECTED_FAILURES,
  applicableFailures,
  failedTests,
  judgeSteps,
  type StepOutcome,
  type TestRecord,
} from "./rollback-failures";

/**
 * `pnpm test:db`: runs CI's database job on this machine. Every step of the `postgres` job in
 * the workflow runs in order, as CI runs it, against a PostgreSQL cluster this command starts in
 * a temporary folder and removes afterwards. The command never uses a database from your
 * environment, and gives the steps only the job's own synthetic settings and the few settings
 * in PASSED_THROUGH, none of which is a credential.
 *
 *   pnpm test:db                 stop at the first failing step, as CI does
 *   pnpm test:db --keep-going    run every step and report each failure
 *   pnpm test:db --list          print the steps without starting a database
 *   pnpm test:db --previous <checkout>
 *                                run another release's database job, checked out in <checkout>,
 *                                against this checkout's schema (OPS-008; docs/architecture/rollback.md)
 *
 * The workflow is the only list of database groups: a step added there runs here too.
 */

export const WORKFLOW = ".github/workflows/valo-foundation.yml";
export const DATABASE_JOB = "postgres";

/** CI machine setup a local run does not repeat, by step name, with the reason. */
export const LOCAL_SKIPS: Record<string, string> = {
  "Set up pinned pnpm": "package.json already pins the pnpm this checkout uses",
  "Install locked dependencies": "uses the dependencies installed in this checkout",
  "Install Chromium and independent PDF reader before actual render proofs":
    "uses this machine's Chromium and pdftotext, checked before the run",
};

/** The only settings taken from your environment. None is a credential or a database. */
export const PASSED_THROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TZ",
  "CHROMIUM_EXECUTABLE_PATH",
  "PLAYWRIGHT_BROWSERS_PATH",
  // How long the NFR-003 load test runs: VALO_LOAD_SECONDS=1800 is the requirement's 30 minutes.
  "VALO_LOAD_SECONDS",
];

/**
 * The steps of a job that set up its database: its migrations, its logins and their check, and the
 * queue. Run with --previous, these come from this checkout, so that the previous release's own steps
 * meet this release's schema, as they would once this release is deployed and then rolled back.
 */
const SCHEMA_SETUP = [
  /\bdrizzle-kit migrate\b/,
  /\blib\/db\/scripts\/[a-z-]+\.mjs\b/,
  /\bsrc\/scripts\/queue-migration\.ts apply-development\b/,
];
export const setsUpTheDatabase = (step: Pick<PlannedStep, "run">) =>
  SCHEMA_SETUP.some((pattern) => pattern.test(step.run ?? ""));

/** Conditions that keep a step running after an earlier failure, as GitHub does. */
const RUNS_AFTER_FAILURE = new Set(["${{ !cancelled() }}", "!cancelled()", "${{ always() }}", "always()"]);
const STEP_KEYS = new Set(["name", "uses", "with", "run", "env", "if"]);

export type PlannedStep = {
  name: string;
  run?: string;
  env: Record<string, string>;
  runsAfterFailure: boolean;
  skip?: string;
};
export type DatabaseService = { image: string; user: string; password: string; database: string };
export type DatabaseJob = { service: DatabaseService; env: Record<string, string>; steps: PlannedStep[] };

/**
 * A step or job setting as GitHub would give it. The only expression allowed is
 * ${{ github.workspace }}, the checkout's root; anything else would need GitHub to evaluate it.
 */
function settings(value: unknown, where: string, workspace: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw Error(`DATABASE_JOB_UNSUPPORTED: ${where} env`);
  return Object.fromEntries(
    Object.entries(value).map(([key, setting]) => {
      if (!["string", "number", "boolean"].includes(typeof setting))
        throw Error(`DATABASE_JOB_UNSUPPORTED: ${where} env ${key}`);
      if (key === "DATABASE_URL" && where !== "job")
        throw Error(
          `DATABASE_JOB_UNSUPPORTED: ${where} sets DATABASE_URL; only the job's service database is used`,
        );
      const text = String(setting).replaceAll("${{ github.workspace }}", workspace);
      if (text.includes("${{"))
        throw Error(
          `DATABASE_JOB_UNSUPPORTED: ${where} env ${key} uses an expression other than github.workspace`,
        );
      return [key, text];
    }),
  );
}

function planStep(step: Record<string, unknown>, index: number, workspace: string): PlannedStep {
  const label = typeof step.name === "string" ? step.name : `step ${index + 1}`;
  for (const key of Object.keys(step))
    if (!STEP_KEYS.has(key)) throw Error(`DATABASE_JOB_UNSUPPORTED: ${label} uses "${key}"`);
  let runsAfterFailure = false;
  if (step.if !== undefined) {
    if (typeof step.if !== "string" || !RUNS_AFTER_FAILURE.has(step.if.trim()))
      throw Error(`DATABASE_JOB_UNSUPPORTED: ${label} has the condition ${String(step.if)}`);
    runsAfterFailure = true;
  }
  if (typeof step.uses === "string") {
    if (step.run !== undefined)
      throw Error(`DATABASE_JOB_UNSUPPORTED: ${label} both uses an action and runs`);
    return {
      name: typeof step.name === "string" ? step.name : step.uses.split("@")[0]!,
      env: {},
      runsAfterFailure,
      skip: "a GitHub action: checkout, Node setup or artifact upload",
    };
  }
  if (typeof step.run !== "string") throw Error(`DATABASE_JOB_UNSUPPORTED: ${label} neither runs nor uses`);
  if (step.with !== undefined) throw Error(`DATABASE_JOB_UNSUPPORTED: ${label} has "with" without an action`);
  const skip = LOCAL_SKIPS[label];
  return {
    name: label,
    run: step.run,
    env: settings(step.env, label, workspace),
    runsAfterFailure,
    ...(skip ? { skip } : {}),
  };
}

/** The database job from the workflow text, refusing anything this command cannot run faithfully. */
export function readDatabaseJob(text: string, workspace = repositoryRoot): DatabaseJob {
  const workflow = parse(text) as { jobs?: Record<string, Record<string, unknown>> };
  const job = workflow.jobs?.[DATABASE_JOB];
  if (!job) throw Error(`DATABASE_JOB_MISSING: no "${DATABASE_JOB}" job in ${WORKFLOW}`);
  const service = (job.services as Record<string, { image?: unknown; env?: unknown }> | undefined)?.postgres;
  const serviceEnv = settings(service?.env, "service", workspace);
  const image = String(service?.image ?? "");
  const { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database } = serviceEnv;
  if (!/^postgres:\d+/.test(image) || !user || !password || !database)
    throw Error(
      "DATABASE_JOB_UNSUPPORTED: the job needs a postgres service with a user, password and database",
    );
  const env = settings(job.env, "job", workspace);
  // The job's database must be its own service on the runner; nothing else is ever replaced.
  const url = new URL(env.DATABASE_URL ?? "postgresql://unset");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    decodeURIComponent(url.username) !== user ||
    url.pathname !== `/${database}`
  )
    throw Error("DATABASE_JOB_UNSUPPORTED: the job's DATABASE_URL must name its own postgres service");
  if (!Array.isArray(job.steps)) throw Error("DATABASE_JOB_UNSUPPORTED: the job has no steps");
  const steps = (job.steps as Record<string, unknown>[]).map((step, index) =>
    planStep(step, index, workspace),
  );
  for (const name of Object.keys(LOCAL_SKIPS))
    if (!steps.some((step) => step.name === name))
      throw Error(`DATABASE_JOB_CHANGED: "${name}" is no longer a step; update LOCAL_SKIPS`);
  return { service: { image, user, password, database }, env, steps };
}

/** Settings a step wrote to $GITHUB_ENV, in the single-line NAME=value form the job uses. */
export function githubEnvSettings(text: string): Record<string, string> {
  const written: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const setting = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!setting) throw Error(`DATABASE_JOB_UNSUPPORTED: $GITHUB_ENV line "${line.slice(0, 40)}"`);
    if (setting[1] === "DATABASE_URL")
      throw Error(
        "DATABASE_JOB_UNSUPPORTED: a step changes DATABASE_URL; only the job's service database is used",
      );
    // GitHub's runner ignores NODE_OPTIONS written to $GITHUB_ENV, so a local run must not obey it.
    if (setting[1] === "NODE_OPTIONS")
      throw Error(
        "DATABASE_JOB_UNSUPPORTED: a step writes NODE_OPTIONS to $GITHUB_ENV, which GitHub ignores; set it in the job's env",
      );
    written[setting[1]!] = setting[2]!;
  }
  return written;
}

/**
 * What a step runs with: the passed-through settings, the job's settings with DATABASE_URL
 * naming the local cluster, what earlier steps wrote to $GITHUB_ENV, then the step's own. CI is
 * "true" as on GitHub: the database is disposable, which is what tests that check it require.
 */
export function stepEnvironment(
  parent: Record<string, string | undefined>,
  job: DatabaseJob,
  databaseUrl: string,
  written: Record<string, string>,
  step: PlannedStep,
  githubEnv: string,
): Record<string, string> {
  const passed = Object.fromEntries(
    PASSED_THROUGH.flatMap((key) => (parent[key] === undefined ? [] : [[key, parent[key]!]])),
  );
  return {
    ...passed,
    CI: "true",
    ...job.env,
    DATABASE_URL: databaseUrl,
    ...written,
    ...step.env,
    GITHUB_ENV: githubEnv,
  };
}

function onPath(command: string, path = process.env.PATH ?? "") {
  return path.split(delimiter).some((dir) => dir && existsSync(join(dir, command)));
}

/** The PostgreSQL server programs: VALO_PG_BIN, then pg_config, then the newest Debian install, then PATH. */
export function postgresPrograms(env: Record<string, string | undefined> = process.env): string {
  const candidates: string[] = [];
  if (env.VALO_PG_BIN) candidates.push(env.VALO_PG_BIN);
  try {
    candidates.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8", stdio: "pipe" }).trim());
  } catch {
    // pg_config is often absent where only the server is installed; the next places are tried.
  }
  const debian = "/usr/lib/postgresql";
  if (existsSync(debian))
    candidates.push(
      ...readdirSync(debian)
        .filter((version) => /^\d+$/.test(version))
        .sort((a, b) => Number(b) - Number(a))
        .map((version) => join(debian, version, "bin")),
    );
  candidates.push(...(env.PATH ?? "").split(delimiter).filter(Boolean));
  const found = candidates.find((dir) =>
    ["initdb", "pg_ctl", "createdb"].every((p) => existsSync(join(dir, p))),
  );
  if (!found)
    throw Error("POSTGRES_NOT_FOUND: install PostgreSQL 16, or set VALO_PG_BIN to the folder holding initdb");
  return found;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

type Cluster = { url: string; version: string; stop: () => void };

/** A cluster set up as CI's service is (same user, password and database, password logins). */
async function startCluster(programs: string, service: DatabaseService): Promise<Cluster> {
  if (process.getuid?.() === 0)
    throw Error("DATABASE_TESTS_AS_ROOT: PostgreSQL does not start as root; run this as an ordinary user");
  const folder = mkdtempSync(join(tmpdir(), "valo-database-tests-"));
  const data = join(folder, "data"),
    passwordFile = join(folder, "password");
  const program = (name: string) => join(programs, name);
  const quiet = { stdio: "pipe" as const, env: { PATH: process.env.PATH ?? "", LANG: "C" } };
  let started = false;
  const stop = () => {
    if (started)
      try {
        execFileSync(program("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], quiet);
      } catch {
        // The folder is removed below either way; a server that would not stop dies with it.
      }
    rmSync(folder, { recursive: true, force: true });
  };
  try {
    writeFileSync(passwordFile, `${service.password}\n`, { mode: 0o600 });
    execFileSync(
      program("initdb"),
      [
        "-D",
        data,
        "-U",
        service.user,
        `--pwfile=${passwordFile}`,
        "-A",
        "scram-sha-256",
        "-E",
        "UTF8",
        "--no-locale",
      ],
      quiet,
    );
    rmSync(passwordFile);
    const port = await freePort();
    execFileSync(
      program("pg_ctl"),
      [
        "-D",
        data,
        "-l",
        join(folder, "server.log"),
        "-w",
        "-t",
        "60",
        "-o",
        `-p ${port} -k '${folder}' -c listen_addresses=127.0.0.1`,
        "start",
      ],
      quiet,
    );
    started = true;
    execFileSync(
      program("createdb"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", service.user, service.database],
      {
        ...quiet,
        env: { ...quiet.env, PGPASSWORD: service.password },
      },
    );
    const version = execFileSync(program("pg_ctl"), ["--version"], { ...quiet, encoding: "utf8" }).trim();
    const credentials = `${encodeURIComponent(service.user)}:${encodeURIComponent(service.password)}`;
    return { url: `postgresql://${credentials}@127.0.0.1:${port}/${service.database}`, version, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

function runStep(
  step: PlannedStep,
  env: Record<string, string>,
  log: WriteStream,
  timeoutMs: number,
  cwd: string,
) {
  return new Promise<number>((resolveExit) => {
    // GitHub's shell for `run` steps on Linux.
    const child = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run!], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => {
      log.write(`\nSTEP_TIMEOUT after ${timeoutMs / 60000} minutes\n`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveExit(code ?? 1);
    });
  });
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

function within(folder: string, path: string) {
  const inner = relative(folder, path);
  return inner !== "" && !inner.startsWith("..") && !isAbsolute(inner);
}

/**
 * The release whose job runs, and the folder each of its steps runs in: this checkout, or, with
 * --previous, the other release's checkout, apart from the steps that set up the database.
 */
export function chooseRelease(args: string[], root = repositoryRoot) {
  const at = args.indexOf("--previous");
  const previous = at === -1 ? null : args[at + 1];
  const rest = at === -1 ? args : args.filter((_arg, index) => index !== at && index !== at + 1);
  const unknown = rest.filter((arg) => !["--keep-going", "--list"].includes(arg));
  if (unknown.length || (at !== -1 && (!previous || previous.startsWith("--"))))
    throw Error(
      `DATABASE_TESTS_ARGUMENTS_INVALID: ${[...unknown, ...(previous ? [] : ["--previous"])].join(" ")}`,
    );
  const jobRoot = previous ? resolve(previous) : root;
  if (previous && (jobRoot === resolve(root) || !existsSync(join(jobRoot, WORKFLOW))))
    throw Error("DATABASE_TESTS_ARGUMENTS_INVALID: --previous names another checkout, with its own workflow");
  return {
    jobRoot,
    previous: Boolean(previous),
    folderFor: (step: Pick<PlannedStep, "run">) => (previous && !setsUpTheDatabase(step) ? jobRoot : root),
  };
}

async function main(args: string[]) {
  const release = chooseRelease(args);
  const { jobRoot } = release;
  const job = readDatabaseJob(readFileSync(join(jobRoot, WORKFLOW), "utf8"), jobRoot);
  if (args.includes("--list")) {
    for (const [index, step] of job.steps.entries())
      process.stdout.write(
        `${String(index + 1).padStart(2)} ${step.skip ? `skip (${step.skip})` : "run "}  ${step.name}${
          release.previous && !step.skip
            ? ` (${release.folderFor(step) === jobRoot ? "previous release" : "this schema"})`
            : ""
        }\n`,
      );
    return;
  }
  const chromium = process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium";
  const missing = [
    ...(existsSync(chromium) ? [] : [`Chromium (set CHROMIUM_EXECUTABLE_PATH; ${chromium} does not exist)`]),
    ...(onPath("pdftotext") ? [] : ["pdftotext (poppler-utils)"]),
  ];
  if (missing.length) throw Error(`DATABASE_TESTS_NEED: ${missing.join(" and ")}; CI installs both`);
  const programs = postgresPrograms();
  const logs = join(
    repositoryRoot,
    "generated-artifacts",
    release.previous ? "database-tests-previous" : "database-tests",
  );
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  const githubEnv = join(logs, "github-env");
  writeFileSync(githubEnv, "");
  const cluster = await startCluster(programs, job.service);
  const interrupted = () => {
    cluster.stop();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  process.stdout.write(
    `database: ${cluster.version}, temporary, removed afterwards\nlogs: ${relative(repositoryRoot, logs)}\n${
      release.previous ? `job: the release in ${jobRoot}, against this checkout's schema\n` : ""
    }`,
  );
  // The job's test results must start empty, as on a fresh runner, so its citation check never
  // reads the results of an earlier run in this checkout.
  if (job.env.VALO_TEST_RESULTS_DIR) {
    const records = resolve(job.env.VALO_TEST_RESULTS_DIR);
    if (!within(join(jobRoot, "generated-artifacts"), records))
      throw Error("DATABASE_JOB_UNSUPPORTED: VALO_TEST_RESULTS_DIR must be inside generated-artifacts");
    rmSync(records, { recursive: true, force: true });
  }
  // Run against this schema, the previous release's job always runs every step, so that each failure
  // can be judged against the register of expected ones.
  const keepGoing = args.includes("--keep-going") || release.previous;
  const recordsDir = job.env.VALO_TEST_RESULTS_DIR ? resolve(job.env.VALO_TEST_RESULTS_DIR) : null;
  if (release.previous && !recordsDir)
    throw Error("DATABASE_JOB_UNSUPPORTED: the previous release's job records no test results");
  const recordFiles = () =>
    recordsDir && existsSync(recordsDir)
      ? readdirSync(recordsDir).filter((name) => name.endsWith(".jsonl"))
      : [];
  const outcomes: StepOutcome[] = [];
  const results: { name: string; outcome: string }[] = [];
  let written: Record<string, string> = {};
  let failed = false;
  try {
    for (const [index, step] of job.steps.entries()) {
      const number = String(index + 1).padStart(2, "0");
      if (step.skip) {
        results.push({ name: step.name, outcome: "skip" });
        continue;
      }
      if (failed && !keepGoing && !step.runsAfterFailure) {
        results.push({ name: step.name, outcome: "not run" });
        continue;
      }
      const logPath = join(logs, `${number}-${slug(step.name)}.log`);
      const log = createWriteStream(logPath);
      const started = Date.now();
      const recordedBefore = new Set(recordFiles());
      const code = await runStep(
        step,
        stepEnvironment(process.env, job, cluster.url, written, step, githubEnv),
        log,
        20 * 60 * 1000,
        release.folderFor(step),
      );
      await new Promise<void>((done) => log.end(() => done()));
      const before = Object.keys(written).length;
      written = githubEnvSettings(readFileSync(githubEnv, "utf8"));
      // The job's nested-connection records must start empty, as on a fresh runner.
      if (Object.keys(written).length !== before && written.VALO_NESTED_REPORT_DIR) {
        const records = resolve(written.VALO_NESTED_REPORT_DIR);
        if (!within(join(jobRoot, "generated-artifacts"), records))
          throw Error("DATABASE_JOB_UNSUPPORTED: VALO_NESTED_REPORT_DIR must be inside generated-artifacts");
        rmSync(records, { recursive: true, force: true });
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (release.previous) {
        const records = recordFiles()
          .filter((name) => !recordedBefore.has(name))
          .flatMap((name) =>
            readFileSync(join(recordsDir!, name), "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as TestRecord),
          );
        outcomes.push({ name: step.name, run: step.run!, code, failed: failedTests(records, jobRoot) });
      }
      const outcome = code === 0 ? "pass" : "FAIL";
      results.push({ name: step.name, outcome });
      process.stdout.write(`${number} ${outcome.padEnd(4)} ${seconds.padStart(6)}s  ${step.name}\n`);
      if (code !== 0) {
        failed = true;
        const tail = readFileSync(logPath, "utf8").split("\n").slice(-40).join("\n");
        process.stdout.write(`   last lines of ${relative(repositoryRoot, logPath)}:\n${tail}\n`);
      }
    }
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    cluster.stop();
  }
  const count = (outcome: string) => results.filter((r) => r.outcome === outcome).length;
  process.stdout.write(
    `\n${count("pass")} passed, ${count("FAIL")} failed, ${count("not run")} not run, ${count("skip")} skipped (CI setup)\n`,
  );
  if (!release.previous) {
    if (failed) process.exitCode = 1;
    return;
  }
  // OPS-008: the previous release runs on this schema when every failure is one the register expects.
  const tags = (root: string) =>
    (
      JSON.parse(readFileSync(join(root, "lib/db/drizzle/meta/_journal.json"), "utf8")) as {
        entries: { tag: string }[];
      }
    ).entries.map((entry) => entry.tag);
  const expected = applicableFailures(
    JSON.parse(readFileSync(join(repositoryRoot, EXPECTED_FAILURES), "utf8")),
    tags(repositoryRoot),
    tags(jobRoot),
  );
  const judged = judgeSteps(outcomes, expected);
  for (const step of judged.steps)
    process.stdout.write(
      step.explained
        ? `expected: ${step.name} (${step.expected ? `${step.expected} expected test failures` : "its cited tests failed as expected"})\n`
        : `NOT EXPECTED: ${step.name}${step.unexpected.map((test) => `\n   ${test.file}: ${test.path.join(" > ")}`).join("")}\n`,
    );
  for (const test of judged.unused)
    process.stdout.write(
      `NOT SEEN: ${test.file}: ${test.path.join(" > ")} was expected to fail and did not\n`,
    );
  process.stdout.write(
    judged.passed
      ? "the previous release runs on this schema: every failure is one the register expects\n"
      : "the previous release does not run on this schema as the register says\n",
  );
  if (!judged.passed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
