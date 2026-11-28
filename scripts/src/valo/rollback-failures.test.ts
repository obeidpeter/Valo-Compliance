import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";
import {
  EXPECTED_FAILURES,
  applicableFailures,
  failedTests,
  judgeSteps,
  type ExpectedFailure,
} from "./rollback-failures";

const checkout = "/tmp/previous-release";
const file = "artifacts/api-server/src/routes/valo-tenant-substitution.integration.test.ts";
const listed = ["the substitution cases", "every private table has substitution cases or a recorded reason"];
const entry: ExpectedFailure = {
  migrations: ["0300_new_private_table", "0301_another_private_table"],
  file,
  tests: [listed],
  reason: "The test lists the tables that hold a workspace's rows, and the new table lengthens the list.",
};

test("a failed test is judged by the subtest that failed inside it, once", () => {
  const records = [
    { file: `${checkout}/${file}`, path: ["the substitution cases"], status: "fail" },
    { file: `${checkout}/${file}`, path: listed, status: "fail" },
    { file: `${checkout}/${file}`, path: listed, status: "fail" },
    { file: `${checkout}/${file}`, path: ["the substitution cases", "another case"], status: "pass" },
  ];
  assert.deepEqual(failedTests(records, checkout), [{ file, path: listed }]);
});

test("an expected failure is read only while one of its migrations is new to the previous release", () => {
  const register = { failures: [entry] };
  const current = ["0299_old", "0300_new_private_table", "0301_another_private_table"];
  assert.deepEqual(applicableFailures(register, current, ["0299_old"]), [entry]);
  // Still read while either of its migrations is new, and no longer once the previous release has both.
  assert.deepEqual(applicableFailures(register, current, ["0299_old", "0300_new_private_table"]), [entry]);
  assert.deepEqual(applicableFailures(register, current, current), []);
  // An entry for a migration this release lacks, or one without a reason, file or name, is refused.
  for (const wrong of [
    { failures: [{ ...entry, migrations: ["0300_new_private_table", "0302_unknown"] }] },
    { failures: [{ ...entry, migrations: [] }] },
    { failures: [{ ...entry, reason: "short" }] },
    { failures: [{ ...entry, file: "../outside.test.ts" }] },
    { failures: [{ ...entry, tests: [] }] },
    { failures: [{ ...entry, tests: [[]] }] },
    { failures: [{ ...entry, tests: [listed, [""]] }] },
    {},
  ])
    assert.throws(
      () => applicableFailures(wrong, ["0300_new_private_table", "0301_another_private_table"], []),
      /ROLLBACK_EXPECTED_FAILURES_INVALID/,
    );
});

test("the previous release runs on this schema only when every failure is one the register expects", () => {
  const evidence = {
    name: "Check every test the evidence register cites for this job passed",
    run: "pnpm --filter @workspace/scripts valo:ci-evidence --job postgres",
  };
  const substitution = {
    name: "Prove another workspace's identifiers are refused like unknown ones on every private route (SEC-001)",
    run: "pnpm --filter @workspace/api-server test:valo-tenant-substitution",
  };
  const other = { name: "Prove tenant boundaries, conflicts and history", run: "pnpm test:valo-db-core" };
  const expected = { file, path: listed };
  // The expected failure, and the evidence check that fails because of it: the release still runs.
  const fine = judgeSteps(
    [
      { ...substitution, code: 1, failed: [expected] },
      { ...other, code: 0, failed: [] },
      { ...evidence, code: 1, failed: [] },
    ],
    [entry],
  );
  assert.equal(fine.passed, true);
  assert.deepEqual(
    fine.steps.map((step) => [step.name, step.explained]),
    [
      [substitution.name, true],
      [evidence.name, true],
    ],
  );
  // Any other failed test, or a step that failed with no test failing in it, is not explained.
  const otherTest = {
    file: "artifacts/api-server/src/routes/valo-db-core.integration.test.ts",
    path: ["writes"],
  };
  assert.equal(
    judgeSteps([{ ...substitution, code: 1, failed: [expected, otherTest] }], [entry]).passed,
    false,
  );
  assert.equal(
    judgeSteps(
      [
        { ...substitution, code: 1, failed: [expected] },
        { ...other, code: 1, failed: [] },
      ],
      [entry],
    ).passed,
    false,
  );
  // The evidence check is explained only by expected failures, never on its own.
  assert.equal(judgeSteps([{ ...evidence, code: 1, failed: [] }], []).passed, false);
  // An expected failure whose test passed is a mistake in the register.
  const unused = judgeSteps([{ ...substitution, code: 0, failed: [] }], [entry]);
  assert.equal(unused.passed, false);
  assert.deepEqual(unused.unused, [expected]);
});

test("an entry lists the tests of one file that fail for one reason, and each of them must fail", () => {
  const step = {
    name: "Prove controlled payment settlement and refund lifecycle",
    run: "pnpm --filter @workspace/api-server test:valo-commerce",
  };
  const refunds = "artifacts/api-server/src/modules/commerce/valo-refunds.integration.test.ts";
  const [first, second] = [
    ["refund lifecycle", "strict amounts"],
    ["refund lifecycle", "racing decisions"],
  ];
  const planted: ExpectedFailure = {
    migrations: ["0302_order_guard"],
    file: refunds,
    tests: [first!, second!],
    reason: "Each test plants an order the guard refuses, in a shape the release's own code never writes.",
  };
  const both = judgeSteps(
    [
      {
        ...step,
        code: 1,
        failed: [
          { file: refunds, path: first! },
          { file: refunds, path: second! },
        ],
      },
    ],
    [planted],
  );
  assert.equal(both.passed, true);
  assert.deepEqual(both.steps[0]?.expected, 2);
  // One of the two passing is a mistake in the register, named on its own; a test of another file of the
  // same names is not one the entry lists.
  const one = judgeSteps([{ ...step, code: 1, failed: [{ file: refunds, path: first! }] }], [planted]);
  assert.equal(one.passed, false);
  assert.deepEqual(one.unused, [{ file: refunds, path: second }]);
  // A test of another file of the same name, or a subtest inside a listed test, is not one the entry
  // lists: each is a failure the register does not expect, named on its own.
  const single: ExpectedFailure = { ...planted, tests: [first!] };
  const elsewhere = {
    file: "artifacts/api-server/src/modules/commerce/valo-commerce.integration.test.ts",
    path: first!,
  };
  const other = judgeSteps([{ ...step, code: 1, failed: [elsewhere] }], [single]);
  assert.equal(other.passed, false);
  assert.deepEqual(other.steps[0]?.unexpected, [elsewhere]);
  const parent: ExpectedFailure = { ...planted, tests: [["refund lifecycle"]] };
  const inside = { file: refunds, path: first! };
  const within = judgeSteps([{ ...step, code: 1, failed: [inside] }], [parent]);
  assert.equal(within.passed, false);
  assert.deepEqual(within.steps[0]?.unexpected, [inside]);
});

test("the repository's register of expected failures is well formed for this release", () => {
  const register = JSON.parse(readFileSync(join(repositoryRoot, EXPECTED_FAILURES), "utf8"));
  const journal = JSON.parse(
    readFileSync(join(repositoryRoot, "lib/db/drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const tags = journal.entries.map((e) => e.tag);
  // Against an empty previous release every entry applies, so each is checked.
  assert.equal(applicableFailures(register, tags, []).length, register.failures.length);
});
