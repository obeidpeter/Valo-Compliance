// Which release the rollback job runs against this schema (OPS-008; docs/architecture/rollback.md).
import test from "node:test";
import assert from "node:assert/strict";
import { INTEGRATION, previousRelease } from "./previous_release.mjs";

const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const never = () => {
  throw Error("the merge base was not asked for");
};

test("a pull request is rolled back to the commit it would merge into", () => {
  assert.equal(
    previousRelease({ event: "pull_request", base: a, before: b, ref: "refs/pull/1/merge" }, never),
    a,
  );
  assert.throws(
    () => previousRelease({ event: "pull_request", base: "", ref: "refs/pull/1/merge" }, never),
    /PREVIOUS_RELEASE_UNKNOWN: the pull request names no base commit/,
  );
});

test("a push to the integration branch is rolled back to what that branch held before it", () => {
  assert.equal(previousRelease({ event: "push", before: b, ref: `refs/heads/${INTEGRATION}` }, never), b);
  assert.equal(previousRelease({ event: "push", before: b, ref: "refs/heads/main" }, never), b);
  // A branch made by the push has no earlier commit: it is measured from the integration branch.
  assert.equal(
    previousRelease(
      { event: "push", before: "0".repeat(40), ref: `refs/heads/${INTEGRATION}` },
      () => `${c}\n`,
    ),
    c,
  );
});

test("any other branch is rolled back to where it leaves the integration branch", () => {
  assert.equal(
    previousRelease({ event: "push", before: b, ref: "refs/heads/claude/a-slice" }, () => `${c}\n`),
    c,
  );
  assert.equal(
    previousRelease({ event: "workflow_dispatch", ref: "refs/heads/claude/a-slice" }, () => c),
    c,
  );
  assert.throws(
    () =>
      previousRelease(
        { event: "push", before: b, ref: "refs/heads/claude/a-slice" },
        () => "fatal: no merge base",
      ),
    /shares no history with/,
  );
  assert.throws(
    () => previousRelease({ event: "schedule", ref: `refs/heads/${INTEGRATION}` }, never),
    /no previous release is named for a schedule event/,
  );
});
