import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEWED_DEPENDENCY_ADVISORIES,
  dependencySummary,
  installedDependencyPaths,
  secretSummary,
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
  },
];
const review = (installed: string[]) => ({
  advisories: reviewed,
  installedPaths: { picomatch: installed },
});

test("a reviewed advisory passes only within its reviewed subtree", () => {
  const sibling = "lib__api-spec>orval>@orval/zod>@orval/core>tinyglobby>fdir>picomatch";
  const passed = dependencySummary(audit([[reviewedPath]]), review([reviewedPath, sibling]));
  assert.equal(passed.status, "pass");
  assert.deepEqual(passed.reviewed, [
    { id: "GHSA-fc5q-39xc-vjpf", package: "picomatch", paths: [reviewedPath, sibling].sort() },
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
  assert.equal(
    dependencySummary(audit([[reviewedPath]]), {
      advisories: REVIEWED_DEPENDENCY_ADVISORIES,
      installedPaths: { picomatch: [reviewedPath] },
    }).status,
    "blocked",
  );
});
