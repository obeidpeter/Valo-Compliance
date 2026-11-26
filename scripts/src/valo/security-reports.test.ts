import test from "node:test";
import assert from "node:assert/strict";
import {
  RECORDED_LOWER_ADVISORIES,
  REVIEWED_DEPENDENCY_ADVISORIES,
  advisoryRecordProblems,
  dependencySummary,
  installedDependencyPaths,
  secretSummary,
  type RecordedAdvisory,
  type ReviewedAdvisory,
} from "./security-reports";
test("dependency detector fails on a harmless high canary and strips raw descriptions", () => {
  const marker = "SYNTHETIC_PRIVATE_AUDIT_MARKER";
  const r = dependencySummary({
    metadata: { vulnerabilities: { critical: 0, high: 1 } },
    advisories: {
      x: {
        id: 1,
        module_name: "fake-package",
        severity: "high",
        title: marker,
      },
    },
  });
  assert.equal(r.status, "blocked");
  assert.ok(!JSON.stringify(r).includes(marker));
  assert.throws(() => dependencySummary({}), /UNAVAILABLE/);
});
test("secret detector strips matches, secrets and source lines", () => {
  const marker = "SYNTHETIC_PRIVATE_SECRET_MARKER";
  const r = secretSummary([
    { RuleID: "canary", File: "fixture.txt", StartLine: 1, Secret: marker, Match: marker, Line: marker },
  ]);
  assert.equal(r.status, "blocked");
  assert.equal(r.count, 1);
  assert.ok(!JSON.stringify(r).includes(marker));
  assert.throws(() => secretSummary(null), /UNAVAILABLE/);
});

const reviewedPath = "lib__api-spec>orval>@orval/core>tinyglobby>picomatch";
const audit = (paths: string[][], high = paths.length) => ({
  metadata: { vulnerabilities: { critical: 0, high } },
  advisories: {
    "1": {
      github_advisory_id: "GHSA-fc5q-39xc-vjpf",
      module_name: "picomatch",
      severity: "high",
      findings: paths.map((p) => ({ version: "4.0.7", paths: p })),
    },
  },
});
// The gate tolerates no advisory today (REVIEWED_DEPENDENCY_ADVISORIES is empty), so its handling of
// a reviewed one is tested with this synthetic review of the advisory it last tolerated.
const reviewed: typeof REVIEWED_DEPENDENCY_ADVISORIES = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    within: ["lib__api-spec>orval>"],
    reason: "Synthetic review for the gate's own test; not a review of the advisory.",
    reviewedOn: "2026-11-17",
    owner: "Security lead",
    reviewBy: "2026-12-17",
  },
];
const review = (installed: string[]) => ({
  advisories: reviewed,
  installedPaths: { picomatch: installed },
  today: "2026-11-20",
});

test("a reviewed advisory passes only within its reviewed subtree", () => {
  const sibling = "lib__api-spec>orval>@orval/zod>@orval/core>tinyglobby>fdir>picomatch";
  const passed = dependencySummary(audit([[reviewedPath]]), review([reviewedPath, sibling]));
  assert.equal(passed.status, "pass");
  assert.deepEqual(passed.reviewed, [
    {
      id: "GHSA-fc5q-39xc-vjpf",
      package: "picomatch",
      paths: [reviewedPath, sibling].sort(),
      owner: "Security lead",
      reviewBy: "2026-12-17",
    },
  ]);
  // Another development tool of the same importer is not the reviewed subtree.
  assert.equal(
    dependencySummary(audit([[reviewedPath]]), review([reviewedPath, "lib__api-spec>other-tool>picomatch"]))
      .status,
    "blocked",
  );
  const production = "artifacts__api-server(dependencies)>http-proxy-middleware>micromatch>picomatch";
  // Another installed path, even one the audit's single sample omits, still blocks.
  assert.equal(
    dependencySummary(audit([[reviewedPath]]), review([reviewedPath, production])).status,
    "blocked",
  );
  assert.equal(
    dependencySummary(
      audit([[reviewedPath], ["artifacts__mockup-sandbox>vite>picomatch"]]),
      review([reviewedPath]),
    ).status,
    "blocked",
  );
  // The same chain reached as a production dependency is not the reviewed path.
  assert.equal(
    dependencySummary(
      audit([[reviewedPath]]),
      review(["lib__api-spec(dependencies)>orval>@orval/core>tinyglobby>picomatch"]),
    ).status,
    "blocked",
  );
  // Without the installed tree, or without a review, nothing is set aside.
  assert.equal(dependencySummary(audit([[reviewedPath]]), review([])).status, "blocked");
  assert.equal(dependencySummary(audit([[reviewedPath]])).status, "blocked");
  // Totals the set-aside advisory does not account for still block.
  assert.equal(dependencySummary(audit([[reviewedPath]], 2), review([reviewedPath])).status, "blocked");
});

test("installed dependency paths follow every chain and name non-development roots", () => {
  const root = "/repo";
  const why = [
    { name: "workspace", path: "/repo" },
    {
      name: "@workspace/api-spec",
      path: "/repo/lib/api-spec",
      devDependencies: {
        orval: {
          dependencies: {
            "@orval/core": { dependencies: { tinyglobby: { dependencies: { picomatch: {} } } } },
          },
        },
      },
    },
    {
      name: "@workspace/api-server",
      path: "/repo/artifacts/api-server",
      dependencies: {
        "http-proxy-middleware": { dependencies: { micromatch: { dependencies: { picomatch: {} } } } },
      },
    },
  ];
  assert.deepEqual(installedDependencyPaths(why, "picomatch", root), [
    "artifacts__api-server(dependencies)>http-proxy-middleware>micromatch>picomatch",
    reviewedPath,
  ]);
  assert.throws(() => installedDependencyPaths({}, "picomatch", root), /UNAVAILABLE/);
});

// SEC-007: an advisory the audit no longer reports is not kept as an exception. With none reviewed,
// any advisory the audit reports blocks the merge.
test("no advisory is tolerated today, so any the audit reports blocks", () => {
  assert.deepEqual(REVIEWED_DEPENDENCY_ADVISORIES, []);
  assert.deepEqual(RECORDED_LOWER_ADVISORIES, []);
  assert.equal(
    dependencySummary(audit([[reviewedPath]]), {
      advisories: REVIEWED_DEPENDENCY_ADVISORIES,
      installedPaths: { picomatch: [reviewedPath] },
    }).status,
    "blocked",
  );
});

test("a reviewed advisory names its owner and is reviewed again within 30 days, or it blocks the merge (SEC-007)", () => {
  const paths = { picomatch: [reviewedPath] };
  const summary = (entry: Partial<ReviewedAdvisory>, today = "2026-11-20") =>
    dependencySummary(audit([[reviewedPath]]), {
      advisories: [{ ...reviewed[0]!, ...entry } as ReviewedAdvisory],
      installedPaths: paths,
      today,
    });
  const passed = summary({});
  assert.equal(passed.status, "pass");
  assert.deepEqual(passed.reviewed, [
    {
      id: "GHSA-fc5q-39xc-vjpf",
      package: "picomatch",
      paths: [reviewedPath],
      owner: "Security lead",
      reviewBy: "2026-12-17",
    },
  ]);
  // On its last day it still stands; the day after, it blocks.
  assert.equal(summary({}, "2026-12-17").status, "pass");
  const lapsed = summary({}, "2026-12-18");
  assert.equal(lapsed.status, "blocked");
  assert.deepEqual(lapsed.recordProblems, [
    { id: "GHSA-fc5q-39xc-vjpf", package: "picomatch", problem: "ADVISORY_PAST_ITS_DATE" },
  ]);
  assert.deepEqual(lapsed.reviewed, []);
  const problem = (entry: Partial<ReviewedAdvisory>) => summary(entry).recordProblems[0]?.problem;
  // No owner, or one that is not a role: no review date, or a malformed one.
  assert.equal(
    problem({ owner: undefined as unknown as ReviewedAdvisory["owner"] }),
    "ADVISORY_OWNER_MISSING",
  );
  assert.equal(problem({ owner: "Whoever" as ReviewedAdvisory["owner"] }), "ADVISORY_OWNER_MISSING");
  assert.equal(problem({ reviewBy: undefined as unknown as string }), "ADVISORY_DATE_INVALID");
  assert.equal(problem({ reviewBy: "2026-02-30" }), "ADVISORY_DATE_INVALID");
  // Reviewed again more than 30 days on, before the review, or a review dated after today.
  assert.equal(problem({ reviewBy: "2026-12-18" }), "ADVISORY_DATE_BEYOND_ITS_TIME_FRAME");
  assert.equal(problem({ reviewBy: "2026-11-16" }), "ADVISORY_DATE_BEYOND_ITS_TIME_FRAME");
  assert.equal(
    problem({ reviewedOn: "2026-11-21", reviewBy: "2026-12-01" }),
    "ADVISORY_RECORDED_AFTER_TODAY",
  );
  for (const entry of [{ owner: "Whoever" }, { reviewBy: "2026-12-18" }] as Partial<ReviewedAdvisory>[])
    assert.equal(summary(entry).status, "blocked");
  // An exception past its date blocks even when the audit no longer reports its advisory.
  assert.equal(
    dependencySummary(
      { metadata: { vulnerabilities: {} }, advisories: {} },
      { advisories: reviewed, today: "2026-12-18" },
    ).status,
    "blocked",
  );
  assert.throws(() => advisoryRecordProblems(reviewed, [], "26 November"), /ADVISORY_TODAY_INVALID/);
});

test("a moderate or low advisory blocks the merge unless it is recorded with its owner and fixed within 30 or 90 days (SEC-007)", () => {
  const lowerAudit = (severity: string, occurrences = 1) => ({
    metadata: { vulnerabilities: { [severity]: occurrences } },
    advisories: {
      "1": {
        github_advisory_id: "GHSA-synt-heti-cxxx",
        module_name: "synthetic-package",
        severity,
        findings: Array.from({ length: occurrences }, () => ({ paths: [".>synthetic-package"] })),
      },
    },
  });
  const record = (entry: Partial<RecordedAdvisory> = {}): RecordedAdvisory => ({
    id: "GHSA-synt-heti-cxxx",
    package: "synthetic-package",
    severity: "moderate",
    reason: "Synthetic record for the gate's own test; not a record of a real advisory.",
    recordedOn: "2026-11-01",
    owner: "Engineering lead",
    fixBy: "2026-12-01",
    ...entry,
  });
  const summary = (input: unknown, lower: RecordedAdvisory[], today = "2026-11-20") =>
    dependencySummary(input, { lower, today });
  // Not recorded, a moderate or a low advisory blocks.
  assert.equal(summary(lowerAudit("moderate"), []).status, "blocked");
  assert.equal(summary(lowerAudit("low"), []).status, "blocked");
  // Recorded, it stands until its date, for its own severity only.
  const passed = summary(lowerAudit("moderate"), [record()]);
  assert.equal(passed.status, "pass");
  assert.deepEqual(passed.recorded, [
    {
      id: "GHSA-synt-heti-cxxx",
      package: "synthetic-package",
      severity: "moderate",
      owner: "Engineering lead",
      fixBy: "2026-12-01",
    },
  ]);
  assert.equal(summary(lowerAudit("moderate", 2), [record()]).status, "pass");
  assert.equal(summary(lowerAudit("moderate"), [record()], "2026-12-01").status, "pass");
  assert.equal(summary(lowerAudit("moderate"), [record()], "2026-12-02").status, "blocked");
  assert.equal(summary(lowerAudit("moderate"), [record({ severity: "low" })]).status, "blocked");
  assert.equal(summary(lowerAudit("high"), [record()]).status, "blocked");
  // 30 days for a moderate advisory, 90 for a low one.
  assert.equal(summary(lowerAudit("moderate"), [record({ fixBy: "2026-12-02" })]).status, "blocked");
  const low = record({ severity: "low", fixBy: "2027-01-30" });
  assert.equal(summary(lowerAudit("low"), [low]).status, "pass");
  assert.equal(summary(lowerAudit("low"), [{ ...low, fixBy: "2027-01-31" }]).status, "blocked");
  assert.deepEqual(
    advisoryRecordProblems([], [{ ...low, fixBy: "2027-01-31" }], "2026-11-20").map((p) => p.problem),
    ["ADVISORY_DATE_BEYOND_ITS_TIME_FRAME"],
  );
  // Without an owner, or recorded as another severity, a record blocks.
  assert.deepEqual(
    advisoryRecordProblems(
      [],
      [
        record({ owner: undefined as unknown as RecordedAdvisory["owner"] }),
        record({ severity: "high" as RecordedAdvisory["severity"] }),
      ],
      "2026-11-20",
    ).map((p) => p.problem),
    ["ADVISORY_OWNER_MISSING", "ADVISORY_SEVERITY_NOT_LOWER"],
  );
  // Totals no recorded advisory accounts for still block, as does an advisory the totals leave
  // out; an informational one does not.
  assert.equal(
    summary({ metadata: { vulnerabilities: { moderate: 1 } }, advisories: {} }, []).status,
    "blocked",
  );
  assert.equal(summary({ ...lowerAudit("low"), metadata: { vulnerabilities: {} } }, []).status, "blocked");
  assert.equal(summary(lowerAudit("info"), []).status, "pass");
  // A record past its date blocks even when the audit no longer reports its advisory.
  assert.equal(
    summary({ metadata: { vulnerabilities: {} }, advisories: {} }, [record()], "2026-12-02").status,
    "blocked",
  );
});
