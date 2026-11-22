import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
  validateAllocationPackage,
  validatePackageScope,
  assertWorkPackageMembership,
  finitePackagePreparers,
} from "./inference-allocation-package";
import { additionalInferenceAllocation, requestDigest } from "./inference-budget";
import type { FiniteWork } from "./inference-batch-dispatch";
import { readFile } from "node:fs/promises";
const work = (): FiniteWork => ({
  key: "controlled-factual",
  lane: "publication",
  role: "factual",
  pair: "controlled-pair",
  candidateHash: "a".repeat(64),
  caseHash: "b".repeat(64),
  sourceHashes: [],
  request: {
    model: "gpt-5.4-mini",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: "controlled review" }],
  },
  bindings: {
    candidateVersionId: "11111111-1111-4111-8111-111111111111",
    corpus: null,
    caseId: null,
    sourceFiles: [],
    operationalPlan: { id: "22222222-2222-4222-8222-222222222222", hash: "c".repeat(64), extension: "json" },
  },
});
test("package freezes actual inventory and the original three case rosters without approving them", async () => {
  const pkg = await prepareFiniteAllocationPackage();
  validateAllocationPackage(pkg);
  assert.ok(pkg.contentIds.includes("TPL-07"));
  assert.deepEqual(
    pkg.corpora.map((c) => c.cases.length),
    [60, 80, 60],
  );
  assert.equal(pkg.contentIds.length + pkg.namedContentSections.length, 108);
  assert.equal(pkg.namedContentSections.length, 38);
  assert.deepEqual(pkg.allocation, additionalInferenceAllocation);
  assert.equal(pkg.sourceFiles.length, 7);
  assert.equal(allocationPackageId(pkg), `finite-package:${requestDigest(pkg)}`);
  assert.deepEqual(pkg.supportedPreparers, ["operational-template-pair-v1"]);
  assert.equal("approved" in pkg, false);
});
test("delegated membership cannot broaden the content inventory or enable unsupported preparers", async () => {
  const pkg = await prepareFiniteAllocationPackage(),
    w = work();
  assert.doesNotThrow(() => assertWorkPackageMembership(w, pkg, "TPL-07"));
  assert.throws(() => assertWorkPackageMembership(w, pkg, "unapproved-content"), /OUTSIDE_PACKAGE/);
  for (const id of [
    "TPL-01",
    "TPL-06",
    "TPL-09",
    "TPL-11",
    "TPL-12",
    "TPL-22",
    "TPL-24",
    "TPL-34",
    "TPL-35",
    "TPL-38",
  ])
    assert.doesNotThrow(() => assertWorkPackageMembership(w, pkg, id));
  for (const id of ["TPL-13", "TPL-39", "TPL-40", "GUD-01"])
    assert.throws(() => assertWorkPackageMembership(w, pkg, id), /PREPARER_UNAVAILABLE/);
  const customer = {
    ...w,
    lane: "customer" as const,
    role: "customer" as const,
    pair: null,
    caseHash: pkg.corpora.find((c) => c.name === "customer-ai")!.cases[0]!.hash,
    bindings: {
      ...w.bindings,
      candidateVersionId: null,
      corpus: "customer-ai" as const,
      caseId: pkg.corpora.find((c) => c.name === "customer-ai")!.cases[0]!.id,
    },
  };
  assert.doesNotThrow(() => assertWorkPackageMembership(customer, pkg, null));
  customer.caseHash = "f".repeat(64);
  assert.throws(() => assertWorkPackageMembership(customer, pkg, null), /OUTSIDE_PACKAGE/);
});
test("package allocation, lane ceilings and allowed roles are immutable policy decisions", async () => {
  for (const edit of [
    (p: any) => {
      p.allocation.id = "new-counter";
    },
    (p: any) => {
      p.allocation.capNanoUsd = "60000000000";
    },
    (p: any) => {
      p.laneAttemptLimits.publication = 999;
    },
    (p: any) => {
      p.allowedRoles.push("draft");
    },
    (p: any) => {
      p.sourceFiles[0].path = "../secret";
    },
  ]) {
    const pkg = await prepareFiniteAllocationPackage();
    edit(pkg);
    assert.throws(() => validateAllocationPackage(pkg), /INVALID/);
  }
});
test("historical disabled artifact retains exact source pins but cannot authorize the clarified allocation boundary", async () => {
  const frozen = JSON.parse(
    await readFile(
      new URL("../../../../../docs/valo/evidence/finite-allocation-package-disabled.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(frozen.status, "DISABLED_PROPOSAL_ONLY");
  assert.equal(frozen.ownerApproved, false);
  assert.equal(frozen.enabled, false);
  assert.equal(frozen.approvalRowsWritten, 0);
  assert.equal(frozen.providerCalls, 0);
  assert.throws(() => validateAllocationPackage(frozen.package), /ALLOCATION_PACKAGE_INVALID/);
  // Its content identities remain valid; only its allocation terms are superseded.
  assert.doesNotThrow(() => validatePackageScope(frozen.package));
  assert.equal(frozen.packageHash, requestDigest(frozen.package));
  assert.equal(frozen.packageId, allocationPackageId(frozen.package));
  assert.equal(
    frozen.packageId,
    "finite-package:3f21b47b43700024af042fa1284ed45503115a1f56dba2bd591d727a68df96a8",
  );
  const actual = await prepareFiniteAllocationPackage(new Date(frozen.package.preparedAt));
  validateAllocationPackage(actual);
  // Runtime preparation can improve inside the same frozen content identities without
  // clearing holds or authorising a provider call. The frozen artifact is no longer
  // admission authority, so membership is checked against the current package.
  for (const id of ["TPL-12", "TPL-22", "TPL-24", "TPL-34", "TPL-35", "TPL-38"]) {
    assert.ok(frozen.package.contentIds.includes(id), id);
    assert.doesNotThrow(() => assertWorkPackageMembership(work(), actual, id));
  }
  assert.equal(actual.allocation.startBoundary, "durable-owner-approval-of-exact-finite-package");
  assert.notEqual(requestDigest(actual), frozen.packageHash);
  // In particular, do not normalize/trim JSON or Markdown before file hashing.
  // Object-equivalent corpus data with a changed newline still changes its pin.
  assert.deepEqual(frozen.package.sourceFiles, actual.sourceFiles);
  assert.deepEqual(frozen.package.corpora, actual.corpora);
  assert.deepEqual(frozen.package.contentIds, actual.contentIds);
  assert.deepEqual(frozen.package.namedContentSections, actual.namedContentSections);
});

test("an editorial-case package admits only editorial case pairs, and no other package admits them", async () => {
  const at = new Date();
  const templates = await prepareFiniteAllocationPackage(at),
    editorial = await prepareFiniteAllocationPackage(at, finitePackagePreparers.editorialCases);
  validateAllocationPackage(editorial);
  assert.deepEqual(editorial.supportedPreparers, ["editorial-case-pair-v1"]);
  assert.notEqual(allocationPackageId(editorial), allocationPackageId(templates));
  const row = editorial.corpora
    .find((c) => c.name === "editorial")!
    .cases.find((c) => c.id === "EVAL-EDP-C019")!;
  const evaluation: FiniteWork = {
    ...work(),
    lane: "editorial_evaluation",
    caseHash: row.hash,
    bindings: {
      candidateVersionId: "702d4a86-27de-5ff7-8d76-d590426594ec",
      corpus: "editorial",
      caseId: row.id,
      sourceFiles: [],
      historicalCutoff: at.toISOString(),
    },
  };
  assert.doesNotThrow(() => assertWorkPackageMembership(evaluation, editorial, null));
  assert.throws(() => assertWorkPackageMembership(evaluation, templates, null), /WORK_OUTSIDE_PACKAGE/);
  assert.throws(() => assertWorkPackageMembership(work(), editorial, "TPL-07"), /WORK_OUTSIDE_PACKAGE/);
  assert.throws(
    () => assertWorkPackageMembership({ ...evaluation, caseHash: "f".repeat(64) }, editorial, null),
    /WORK_OUTSIDE_PACKAGE/,
  );
  assert.throws(
    () => assertWorkPackageMembership({ ...evaluation, pair: null }, editorial, null),
    /PREPARER_UNAVAILABLE/,
  );
  const customer: FiniteWork = {
    ...work(),
    lane: "customer",
    role: "customer",
    pair: null,
    caseHash: editorial.corpora.find((c) => c.name === "customer-ai")!.cases[0]!.hash,
    bindings: {
      candidateVersionId: null,
      corpus: "customer-ai",
      caseId: editorial.corpora.find((c) => c.name === "customer-ai")!.cases[0]!.id,
      sourceFiles: [],
    },
  };
  assert.doesNotThrow(() => assertWorkPackageMembership(customer, templates, null));
  assert.throws(() => assertWorkPackageMembership(customer, editorial, null), /WORK_OUTSIDE_PACKAGE/);
});

test("a guide package admits only the review pairs of guides with a claim map, and no other package admits a guide", async () => {
  const at = new Date();
  const templates = await prepareFiniteAllocationPackage(at),
    editorial = await prepareFiniteAllocationPackage(at, finitePackagePreparers.editorialCases),
    guides = await prepareFiniteAllocationPackage(at, finitePackagePreparers.guidePairs);
  validateAllocationPackage(guides);
  assert.deepEqual(guides.supportedPreparers, ["guide-review-pair-v1"]);
  assert.equal(new Set([templates, editorial, guides].map(allocationPackageId)).size, 3);
  // The same inventory, allocation and attempt limits as the other packages: only the kind differs.
  assert.deepEqual(guides.contentIds, templates.contentIds);
  assert.deepEqual(guides.laneAttemptLimits, templates.laneAttemptLimits);
  assert.equal(requestDigest(guides.allocation), requestDigest(additionalInferenceAllocation));
  assert.match(
    guides.holds[0]!,
    /^Supported guide review pairs: GUD-01, .*GUD-10, .*GUD-15, GUD-19, .*GUD-26; /,
  );
  assert.match(guides.holds[0]!, /under the guidance policy as the owner approved it/);

  // A guide with a claim map is admitted under the guide package, with its review plan.
  assert.doesNotThrow(() => assertWorkPackageMembership(work(), guides, "GUD-01"));
  assert.doesNotThrow(() => assertWorkPackageMembership({ ...work(), role: "challenge" }, guides, "GUD-10"));
  // A guide without a claim map has no preparer, and an ID outside the inventory is outside the package.
  assert.doesNotThrow(() => assertWorkPackageMembership(work(), guides, "GUD-15"));
  assert.doesNotThrow(() => assertWorkPackageMembership(work(), guides, "GUD-26"));
  assert.throws(() => assertWorkPackageMembership(work(), guides, "GUD-16"), /PREPARER_UNAVAILABLE/);
  assert.throws(() => assertWorkPackageMembership(work(), guides, "GUD-31"), /WORK_OUTSIDE_PACKAGE/);
  const unplanned = work();
  delete unplanned.bindings.operationalPlan;
  assert.throws(() => assertWorkPackageMembership(unplanned, guides, "GUD-01"), /PREPARER_UNAVAILABLE/);
  // No other package admits a guide.
  assert.throws(() => assertWorkPackageMembership(work(), templates, "GUD-01"), /PREPARER_UNAVAILABLE/);
  assert.throws(() => assertWorkPackageMembership(work(), editorial, "GUD-01"), /WORK_OUTSIDE_PACKAGE/);
  // And the guide package admits nothing else: not a template, a customer case or an editorial case.
  assert.doesNotThrow(() => assertWorkPackageMembership(work(), templates, "TPL-07"));
  assert.throws(() => assertWorkPackageMembership(work(), guides, "TPL-07"), /PREPARER_UNAVAILABLE/);
  const customerCase = guides.corpora.find((c) => c.name === "customer-ai")!.cases[0]!;
  const customer: FiniteWork = {
    ...work(),
    lane: "customer",
    role: "customer",
    pair: null,
    caseHash: customerCase.hash,
    bindings: { candidateVersionId: null, corpus: "customer-ai", caseId: customerCase.id, sourceFiles: [] },
  };
  assert.doesNotThrow(() => assertWorkPackageMembership(customer, templates, null));
  assert.throws(() => assertWorkPackageMembership(customer, guides, null), /WORK_OUTSIDE_PACKAGE/);
  const editorialCase = guides.corpora.find((c) => c.name === "editorial")!.cases[0]!;
  const evaluation: FiniteWork = {
    ...work(),
    lane: "editorial_evaluation",
    caseHash: editorialCase.hash,
    bindings: {
      candidateVersionId: "702d4a86-27de-5ff7-8d76-d590426594ec",
      corpus: "editorial",
      caseId: editorialCase.id,
      sourceFiles: [],
      historicalCutoff: at.toISOString(),
    },
  };
  assert.throws(() => assertWorkPackageMembership(evaluation, guides, null), /WORK_OUTSIDE_PACKAGE/);
});

test("a package names one known preparer set", async () => {
  await assert.rejects(
    () => prepareFiniteAllocationPackage(new Date(), ["another-preparer"] as never),
    /PACKAGE_PREPARERS_INVALID/,
  );
  const pkg = await prepareFiniteAllocationPackage();
  for (const supportedPreparers of [
    [],
    ["editorial-case-pair-v1", "operational-template-pair-v1"],
    ["guide-review-pair-v1", "operational-template-pair-v1"],
    ["x"],
  ])
    assert.throws(
      () => validateAllocationPackage({ ...pkg, supportedPreparers } as never),
      /ALLOCATION_PACKAGE_INVALID/,
    );
});
