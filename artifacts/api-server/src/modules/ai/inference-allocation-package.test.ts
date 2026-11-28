import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
  validateAllocationPackage,
  validatePackageScope,
  assertWorkPackageMembership,
  finitePackagePreparers,
  guideReviewsNeedOwnerCheck,
} from "./inference-allocation-package";
import { additionalInferenceAllocation, requestDigest } from "./inference-budget";
import type { FiniteWork } from "./inference-batch-dispatch";
import { readFile } from "node:fs/promises";
import { preparedRuleIds } from "@workspace/valo-core";
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

// Decision 0018 and docs/architecture/reviewed-route.md, part 2: only a package of the guides' kind admits a
// guide's review pair, and the binding check the dispatcher makes before admission and dispatch asks for
// the development owner's check of the guide's sources (tested in the guide route's database test).
test("only a guide package admits a guide's review pairs, and a guide package admits nothing else", async () => {
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
    /^Supported guide review pairs: GUD-01, .*GUD-10, .*GUD-15, GUD-19, .*GUD-26, GUD-27, .*GUD-30; /,
  );
  assert.match(guides.holds[0]!, /under the guidance policy as the owner approved it/);
  assert.equal(guides.holds[1], guideReviewsNeedOwnerCheck);
  assert.match(guides.holds[1]!, /development owner has checked that exact candidate's official sources/);

  // A guide with a claim map and its review plan is a complete pair, and belongs to the guide package.
  for (const guide of ["GUD-01", "GUD-15", "GUD-26", "GUD-30"])
    assert.doesNotThrow(() => assertWorkPackageMembership(work(), guides, guide));
  assert.doesNotThrow(() => assertWorkPackageMembership({ ...work(), role: "challenge" }, guides, "GUD-10"));
  // A guide without a claim map has no preparer, and an ID outside the inventory is outside the package.
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

// docs/architecture/reviewed-route.md, part 3: only a package of the rules' kind admits a rule's review
// pair, and it admits nothing else. The binding check the dispatcher makes before admission and dispatch
// builds the pair again from the rule's own sources and records (tested in the real-bindings database test).
test("only a rule package admits a rule's review pairs, and a rule package admits nothing else", async () => {
  const at = new Date();
  const templates = await prepareFiniteAllocationPackage(at),
    guides = await prepareFiniteAllocationPackage(at, finitePackagePreparers.guidePairs),
    checker = await prepareFiniteAllocationPackage(at, finitePackagePreparers.checkerChallenges),
    editorial = await prepareFiniteAllocationPackage(at, finitePackagePreparers.editorialCases),
    rules = await prepareFiniteAllocationPackage(at, finitePackagePreparers.rulePairs);
  validateAllocationPackage(rules);
  assert.deepEqual(rules.supportedPreparers, ["rule-review-pair-v1"]);
  assert.equal(new Set([templates, guides, checker, editorial, rules].map(allocationPackageId)).size, 5);
  // The same inventory, allocation and attempt limits as the other packages: only the kind differs.
  assert.deepEqual(rules.contentIds, templates.contentIds);
  assert.deepEqual(rules.laneAttemptLimits, templates.laneAttemptLimits);
  assert.equal(requestDigest(rules.allocation), requestDigest(additionalInferenceAllocation));
  assert.ok(
    rules.holds[0]!.startsWith(
      "Supported rule review pairs: CAC-BUSINESS-NAME-814, NDPA-27-COLLECTION-INFORMATION, NTAA-11-COMPANY-RETURN, NAFDAC-F33-PRODUCT-REGISTRATION; ",
    ),
    rules.holds[0],
  );
  assert.match(rules.holds[0]!, /with a rights record the owner chose for that route/);
  assert.match(rules.holds[1]!, /never legal, tax or regulatory review/);

  // The factual work of a planned review pair of `templateId`'s prepared candidate.
  const planned = (templateId: string, change: Partial<FiniteWork> = {}): FiniteWork => {
    const w = { ...work(), ...change };
    w.bindings = {
      ...w.bindings,
      candidateArtifact: {
        id: "33333333-3333-4333-8333-333333333333",
        hash: "d".repeat(64),
        extension: "json",
        templateId,
      },
    };
    return w;
  };
  // Each rule prepared in the repository, factual or challenge, with its plan, belongs to the rule package.
  for (const id of preparedRuleIds) {
    assert.doesNotThrow(() => assertWorkPackageMembership(planned(id), rules, id));
    assert.doesNotThrow(() => assertWorkPackageMembership(planned(id, { role: "challenge" }), rules, id));
  }
  // No other package admits a rule's pair.
  for (const other of [templates, guides, checker, editorial])
    assert.throws(
      () => assertWorkPackageMembership(planned("CAC-BUSINESS-NAME-814"), other, "CAC-BUSINESS-NAME-814"),
      /WORK_OUTSIDE_PACKAGE/,
    );
  // A rule's work must be a planned review pair of the rule its candidate names, and nothing more.
  const unplanned = planned("CAC-BUSINESS-NAME-814");
  delete unplanned.bindings.operationalPlan;
  const unbound = planned("CAC-BUSINESS-NAME-814");
  unbound.bindings.candidateVersionId = null;
  const withCase = planned("CAC-BUSINESS-NAME-814");
  withCase.bindings.caseId = "EVAL-EDP-C001";
  for (const [outside, contentId] of [
    [planned("CAC-BUSINESS-NAME-814"), "NTAA-11-COMPANY-RETURN"],
    [planned("CAC-BUSINESS-NAME-814", { pair: null }), "CAC-BUSINESS-NAME-814"],
    [planned("CAC-BUSINESS-NAME-814", { retryOf: "earlier" }), "CAC-BUSINESS-NAME-814"],
    [planned("CAC-BUSINESS-NAME-814", { role: "customer" }), "CAC-BUSINESS-NAME-814"],
    [unplanned, "CAC-BUSINESS-NAME-814"],
    [unbound, "CAC-BUSINESS-NAME-814"],
    [withCase, "CAC-BUSINESS-NAME-814"],
    // The rule's own id is not its requirement version, and no other rule is prepared.
    [planned("cac-business-name-814"), "cac-business-name-814"],
    [planned("CAC-BUSINESS-NAME-815"), "CAC-BUSINESS-NAME-815"],
  ] as const)
    assert.throws(() => assertWorkPackageMembership(outside, rules, contentId), /WORK_OUTSIDE_PACKAGE/);
  // And the rule package admits nothing else: not a template's pair or a guide's, even one planned for its
  // own prepared candidate, a customer case, an editorial case or a checker challenge.
  for (const id of ["TPL-07", "GUD-01"]) {
    assert.throws(() => assertWorkPackageMembership(work(), rules, id), /WORK_OUTSIDE_PACKAGE/);
    assert.throws(() => assertWorkPackageMembership(planned(id), rules, id), /WORK_OUTSIDE_PACKAGE/);
  }
  const customerCase = rules.corpora.find((c) => c.name === "customer-ai")!.cases[0]!;
  const customer: FiniteWork = {
    ...work(),
    lane: "customer",
    role: "customer",
    pair: null,
    caseHash: customerCase.hash,
    bindings: { candidateVersionId: null, corpus: "customer-ai", caseId: customerCase.id, sourceFiles: [] },
  };
  assert.throws(() => assertWorkPackageMembership(customer, rules, null), /WORK_OUTSIDE_PACKAGE/);
  const editorialCase = rules.corpora.find((c) => c.name === "editorial")!.cases[0]!;
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
  assert.throws(() => assertWorkPackageMembership(evaluation, rules, null), /WORK_OUTSIDE_PACKAGE/);
  const checkerCase = rules.corpora.find((c) => c.name === "checker")!.cases[0]!;
  const challenge: FiniteWork = {
    ...work(),
    lane: "checker_challenge",
    role: "challenge",
    pair: null,
    caseHash: checkerCase.hash,
    bindings: {
      candidateVersionId: "44444444-4444-4444-8444-444444444444",
      corpus: "checker",
      caseId: checkerCase.id,
      sourceFiles: [],
      historicalCutoff: at.toISOString(),
    },
  };
  assert.doesNotThrow(() => assertWorkPackageMembership(challenge, checker, null));
  assert.throws(() => assertWorkPackageMembership(challenge, rules, null), /WORK_OUTSIDE_PACKAGE/);
});

test("only a package of templates that state the law admits their review pairs, and it admits nothing else", async () => {
  const at = new Date();
  const templates = await prepareFiniteAllocationPackage(at),
    guides = await prepareFiniteAllocationPackage(at, finitePackagePreparers.guidePairs),
    rules = await prepareFiniteAllocationPackage(at, finitePackagePreparers.rulePairs),
    checker = await prepareFiniteAllocationPackage(at, finitePackagePreparers.checkerChallenges),
    editorial = await prepareFiniteAllocationPackage(at, finitePackagePreparers.editorialCases),
    lawTemplates = await prepareFiniteAllocationPackage(at, finitePackagePreparers.lawTemplatePairs);
  validateAllocationPackage(lawTemplates);
  assert.deepEqual(lawTemplates.supportedPreparers, ["law-template-review-pair-v1"]);
  assert.equal(
    new Set([templates, guides, rules, checker, editorial, lawTemplates].map(allocationPackageId)).size,
    6,
  );
  // The same inventory, allocation and attempt limits as the other packages: only the kind differs.
  assert.deepEqual(lawTemplates.contentIds, templates.contentIds);
  assert.deepEqual(lawTemplates.laneAttemptLimits, templates.laneAttemptLimits);
  assert.equal(requestDigest(lawTemplates.allocation), requestDigest(additionalInferenceAllocation));
  assert.ok(
    lawTemplates.holds[0]!.startsWith("Supported review pairs of templates that state the law: TPL-31; "),
    lawTemplates.holds[0],
  );
  assert.match(
    lawTemplates.holds[0]!,
    /under the policy for templates that state the law as the owner approved it/,
  );
  assert.match(lawTemplates.holds[1]!, /never legal, tax or regulatory review/);

  const planned = (templateId: string, change: Partial<FiniteWork> = {}): FiniteWork => {
    const w = { ...work(), ...change };
    w.bindings = {
      ...w.bindings,
      candidateArtifact: {
        id: "33333333-3333-4333-8333-333333333333",
        hash: "d".repeat(64),
        extension: "json",
        templateId,
      },
    };
    return w;
  };
  // TPL-31's planned pair, factual or challenge, belongs to the package of templates that state the law.
  assert.doesNotThrow(() => assertWorkPackageMembership(planned("TPL-31"), lawTemplates, "TPL-31"));
  assert.doesNotThrow(() =>
    assertWorkPackageMembership(planned("TPL-31", { role: "challenge" }), lawTemplates, "TPL-31"),
  );
  // No other package admits it, the templates' own among them.
  for (const other of [templates, guides, rules, checker, editorial])
    assert.throws(
      () => assertWorkPackageMembership(planned("TPL-31"), other, "TPL-31"),
      /WORK_OUTSIDE_PACKAGE/,
    );
  // Its work must be a planned review pair of the template its candidate names, and nothing more.
  const unplanned = planned("TPL-31");
  delete unplanned.bindings.operationalPlan;
  const unbound = planned("TPL-31");
  unbound.bindings.candidateVersionId = null;
  const withCase = planned("TPL-31");
  withCase.bindings.caseId = "EVAL-EDP-C001";
  const withCorpus = planned("TPL-31");
  withCorpus.bindings.corpus = "editorial";
  for (const outside of [
    planned("TPL-31", { pair: null }),
    planned("TPL-31", { retryOf: "earlier" }),
    planned("TPL-31", { role: "customer" }),
    planned("TPL-31", { lane: "editorial_evaluation" }),
    planned("TPL-13"),
    unplanned,
    unbound,
    withCase,
    withCorpus,
  ])
    assert.throws(() => assertWorkPackageMembership(outside, lawTemplates, "TPL-31"), /WORK_OUTSIDE_PACKAGE/);
  // Nor does a package whose frozen inventory does not name the template.
  const withoutIt = { ...lawTemplates, contentIds: lawTemplates.contentIds.filter((id) => id !== "TPL-31") };
  assert.throws(
    () => assertWorkPackageMembership(planned("TPL-31"), withoutIt, "TPL-31"),
    /WORK_OUTSIDE_PACKAGE/,
  );
  // And it admits nothing else: not a form's pair, a guide's, a rule's or a template with no claim map,
  // even one planned for its own prepared candidate.
  for (const id of ["TPL-07", "TPL-13", "GUD-01", "CAC-BUSINESS-NAME-814"]) {
    assert.throws(() => assertWorkPackageMembership(work(), lawTemplates, id), /WORK_OUTSIDE_PACKAGE/);
    assert.throws(() => assertWorkPackageMembership(planned(id), lawTemplates, id), /WORK_OUTSIDE_PACKAGE/);
  }
  const customerCase = lawTemplates.corpora.find((c) => c.name === "customer-ai")!.cases[0]!;
  const customer: FiniteWork = {
    ...work(),
    lane: "customer",
    role: "customer",
    pair: null,
    caseHash: customerCase.hash,
    bindings: { candidateVersionId: null, corpus: "customer-ai", caseId: customerCase.id, sourceFiles: [] },
  };
  assert.throws(() => assertWorkPackageMembership(customer, lawTemplates, null), /WORK_OUTSIDE_PACKAGE/);
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
    ["rule-review-pair-v1", "guide-review-pair-v1"],
    ["law-template-review-pair-v1", "operational-template-pair-v1"],
    ["x"],
  ])
    assert.throws(
      () => validateAllocationPackage({ ...pkg, supportedPreparers } as never),
      /ALLOCATION_PACKAGE_INVALID/,
    );
});
