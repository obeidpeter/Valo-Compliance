import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";
import { LOCAL_SKIPS, WORKFLOW, githubEnvSettings, readDatabaseJob, stepEnvironment } from "./database-tests";

const workflow = readFileSync(`${repositoryRoot}/${WORKFLOW}`, "utf8");

const job = (steps: string, env = "      DATABASE_URL: postgresql://valo_ci:pw@localhost:5432/valo_ci\n") =>
  `jobs:\n  postgres:\n    services:\n      postgres:\n        image: postgres:16\n        env:\n          POSTGRES_USER: valo_ci\n          POSTGRES_PASSWORD: pw\n          POSTGRES_DB: valo_ci\n    env:\n${env}    steps:\n${Object.keys(
    LOCAL_SKIPS,
  )
    .map((name) => `      - name: ${name}\n        run: "true"\n`)
    .join("")}${steps}`;

test("pnpm test:db reads every step of CI's database job and can run each one", () => {
  const { service, env, steps } = readDatabaseJob(workflow);
  assert.equal(service.image, "postgres:16");
  assert.equal(env.VALO_RUN_DB_TESTS, "synthetic-development-only");
  const run = steps.filter((step) => !step.skip);
  assert.ok(run.length >= 25, "the database groups were read");
  assert.ok(run.every((step) => typeof step.run === "string" && step.run.length > 0));
  // Only GitHub actions and the named CI machine setup are left out locally.
  for (const step of steps.filter((s) => s.skip)) assert.ok(!step.run || step.name in LOCAL_SKIPS, step.name);
  assert.ok(
    run.some((step) => step.runsAfterFailure),
    "a step that runs after a failure was read",
  );
  assert.ok(
    run.some((step) => /workspace-login\.mjs/.test(step.run!)),
    "the workspace login is set up",
  );
  assert.ok(
    run.some((step) => /nested-connection-report\.mjs/.test(step.run!)),
    "the nested-connection check runs",
  );
});

test("anything the command cannot run as CI does stops it", () => {
  const refuses = (text: string, pattern: RegExp) => assert.throws(() => readDatabaseJob(text), pattern);
  assert.equal(readDatabaseJob(job("      - name: ok\n        run: echo ok\n")).steps.length, 4);
  refuses(job("      - name: odd\n        run: x\n        shell: python\n"), /UNSUPPORTED: odd uses "shell"/);
  refuses(
    job("      - name: odd\n        if: github.event_name == 'push'\n        run: x\n"),
    /odd has the condition/,
  );
  refuses(
    job(
      "      - name: odd\n        env:\n          DATABASE_URL: postgresql://elsewhere/db\n        run: x\n",
    ),
    /sets DATABASE_URL/,
  );
  refuses(
    job("      - name: odd\n        with:\n          a: b\n        run: x\n"),
    /"with" without an action/,
  );
  refuses(
    job("", "      DATABASE_URL: postgresql://valo_ci:pw@db.example.com:5432/valo_ci\n"),
    /must name its own/,
  );
  refuses(job("", "      DATABASE_URL: postgresql://other:pw@localhost:5432/valo_ci\n"), /must name its own/);
  // Renaming a skipped setup step in the database job (the foundation job has one too).
  const [before, databaseJob] = workflow.split("\n  postgres:\n");
  refuses(
    `${before}\n  postgres:\n${databaseJob!.replace("- name: Set up pinned pnpm", "- name: Set up pnpm")}`,
    /DATABASE_JOB_CHANGED/,
  );
  refuses(workflow.replace("  postgres:\n    name:", "  database:\n    name:"), /DATABASE_JOB_MISSING/);
});

test("settings written to $GITHUB_ENV carry on; other forms, DATABASE_URL and NODE_OPTIONS do not", () => {
  assert.deepEqual(githubEnvSettings("A=1\nB=x=y\n\nA=2\n"), { A: "2", B: "x=y" });
  assert.throws(() => githubEnvSettings("NOTES<<EOF\ntext\nEOF\n"), /GITHUB_ENV line/);
  assert.throws(() => githubEnvSettings("DATABASE_URL=postgresql://elsewhere/db\n"), /changes DATABASE_URL/);
  // GitHub's runner ignores this one, so obeying it locally would test something CI never runs.
  assert.throws(
    () => githubEnvSettings("NODE_OPTIONS=--import x\n"),
    /NODE_OPTIONS to \$GITHUB_ENV, which GitHub ignores/,
  );
});

test("a step gets no database, credential or other setting from your environment", () => {
  const parsed = readDatabaseJob(workflow);
  const step = { name: "s", run: "true", env: { STEP: "step", SHARED: "step" }, runsAfterFailure: false };
  const env = stepEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/home/someone",
      DATABASE_URL: "postgresql://real-database/production",
      VALO_CUSTOMER_DATABASE_URL: "postgresql://real-database/customer",
      PGPASSWORD: "real-password",
      AI_INTEGRATIONS_OPENAI_API_KEY: "real-key",
      CLERK_SECRET_KEY: "real-key",
      SESSION_SECRET: "real-secret",
    },
    parsed,
    "postgresql://valo_ci:synthetic@127.0.0.1:55555/valo_ci",
    { WRITTEN: "earlier", SHARED: "earlier" },
    step,
    "/tmp/github-env",
  );
  assert.equal(env.DATABASE_URL, "postgresql://valo_ci:synthetic@127.0.0.1:55555/valo_ci");
  assert.equal(env.SESSION_SECRET, parsed.env.SESSION_SECRET, "the job's synthetic secret, not yours");
  for (const key of [
    "VALO_CUSTOMER_DATABASE_URL",
    "PGPASSWORD",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "CLERK_SECRET_KEY",
  ])
    assert.equal(env[key], undefined, key);
  assert.deepEqual(
    [env.PATH, env.HOME, env.CI, env.GITHUB_ENV],
    ["/usr/bin", "/home/someone", "true", "/tmp/github-env"],
  );
  assert.deepEqual([env.WRITTEN, env.STEP, env.SHARED], ["earlier", "step", "step"]);
});

test("the checkout's root stands in for github.workspace, and any other expression stops the command", () => {
  const service = "      DATABASE_URL: postgresql://valo_ci:pw@localhost:5432/valo_ci\n";
  const parsed = readDatabaseJob(
    job(
      "      - name: ok\n        env:\n          OUT: ${{ github.workspace }}/out\n        run: echo ok\n",
      service + "      RESULTS: ${{ github.workspace }}/results\n",
    ),
    "/checkout",
  );
  assert.equal(parsed.env.RESULTS, "/checkout/results");
  assert.equal(parsed.steps.at(-1)?.env.OUT, "/checkout/out");
  for (const expression of ["${{ secrets.TOKEN }}", "${{ runner.temp }}/x", "${{ env.HOME }}"])
    assert.throws(
      () => readDatabaseJob(job("", service + `      ODD: ${expression}\n`), "/checkout"),
      /uses an expression other than github\.workspace/,
    );
});
