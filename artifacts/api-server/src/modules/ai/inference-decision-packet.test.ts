import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildFiniteDecisionPacket } from "./inference-decision-packet";
import {
  prepareOperationalFiniteManifest,
  finiteManifestProposal,
  type OperationalFiniteInput,
} from "./inference-manifest";
import { requestDigest } from "./inference-budget";
import { prepareCustomerFiniteManifest } from "../ai-lanes/inference-customer-manifest";
import { prepareFiniteAllocationPackage, allocationPackageId } from "./inference-allocation-package";
import { selectPreparedProposal, parseFinitePreparationOptions } from "../ai-lanes/inference-prepared-report";
import { prepareEditorialCaseManifest } from "../editorial/editorial-case-reviews";
const now = new Date("2026-11-15T05:00:00Z"),
  expiry = "2026-11-15T06:00:00Z";
function prepared() {
  const input: OperationalFiniteInput = {
    candidateVersionId: "11111111-1111-4111-8111-111111111111",
    candidateArtifact: {
      id: "44444444-4444-4444-8444-444444444444",
      hash: "9".repeat(64),
      extension: "json",
      templateId: "TPL-12",
    },
    candidateHash: "a".repeat(64),
    bundleHash: "b".repeat(64),
    sourceHashes: [],
    sourceFiles: [{ path: "docs/source.md", sha256: "c".repeat(64) }],
    plan: {
      manifest: {
        candidateHash: "a".repeat(64),
        preparedAt: now.toISOString(),
        expiresAt: expiry,
        status: "mechanically_planned_not_reserved",
      },
      artifact: { id: "22222222-2222-4222-8222-222222222222", hash: "d".repeat(64), extension: "json" },
      entries: (["factual", "challenge"] as const).map((role) => ({
        role,
        request: {
          model: "gpt-5.4-mini",
          max_completion_tokens: 8192,
          messages: [{ role: "user", content: `Controlled ${role} request` }],
        },
      })),
    },
  };
  const m = prepareOperationalFiniteManifest(input, now);
  m.packageId = `finite-package:${"e".repeat(64)}`;
  return finiteManifestProposal(m, expiry);
}
function artifact(p: ReturnType<typeof prepared>) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    extension: "json" as const,
    hash: createHash("sha256").update(JSON.stringify(p.manifest)).digest("hex"),
  };
}
const capacity = {
  stateFingerprint: "f".repeat(64),
  uncommittedCapacityNanoUsd: "30000000000",
  observedAt: now.toISOString(),
};
async function mixed(retry = true) {
  const pkg = await prepareFiniteAllocationPackage(now),
    id = allocationPackageId(pkg),
    publication = prepared();
  publication.manifest.packageId = id;
  const p = finiteManifestProposal(publication.manifest, expiry);
  const customer = await prepareCustomerFiniteManifest("CAI-CAND-INV-01", { retry, now, packageId: id });
  return { pkg, p, q: finiteManifestProposal(customer.manifest, expiry) };
}
test("preparation options preserve explicit retries and never accept approval or quota assertions", () => {
  const packageId = `finite-package:${"e".repeat(64)}`;
  assert.equal(parseFinitePreparationOptions(["--practical-guide-pairs"]).practicalPairs, true);
  assert.equal(parseFinitePreparationOptions(["--reminder-inventory-pairs"]).reminderInventoryPairs, true);
  for (const option of [
    "--practical-guide-pairs",
    "--guide-pairs",
    "--with-schema-retry",
    `--package=${packageId}`,
  ])
    assert.throws(
      () => parseFinitePreparationOptions(["--reminder-inventory-pairs", option]),
      /FINITE_PREPARATION_OPTIONS_INVALID/,
    );
  for (const option of ["--guide-pairs", "--with-schema-retry", `--package=${packageId}`])
    assert.throws(
      () => parseFinitePreparationOptions(["--practical-guide-pairs", option]),
      /FINITE_PREPARATION_OPTIONS_INVALID/,
    );
  assert.deepEqual(parseFinitePreparationOptions([]), {
    retry: false,
    packageId: undefined,
    candidates: [],
    guidePairs: false,
  });
  assert.deepEqual(parseFinitePreparationOptions([`--package=${packageId}`]), {
    retry: false,
    packageId,
    candidates: [],
    guidePairs: false,
  });
  assert.deepEqual(parseFinitePreparationOptions(["--with-schema-retry", `--package=${packageId}`]), {
    retry: true,
    packageId,
    candidates: [],
    guidePairs: false,
  });
  // Prepared candidates are named by their exact private artifact (decision 0014).
  const one = `55555555-5555-4555-8555-555555555555:${"1".repeat(64)}`,
    two = `66666666-6666-4666-8666-666666666666:${"2".repeat(64)}`;
  assert.deepEqual(parseFinitePreparationOptions([`--candidate=${one}`, `--candidate=${two}`]), {
    retry: false,
    packageId: undefined,
    candidates: [
      { id: "55555555-5555-4555-8555-555555555555", hash: "1".repeat(64), extension: "json" },
      { id: "66666666-6666-4666-8666-666666666666", hash: "2".repeat(64), extension: "json" },
    ],
    guidePairs: false,
  });
  // A new package for the guides' review pairs is asked for by name. An approved package has its
  // kind already, and a retry is never part of asking for one.
  assert.deepEqual(parseFinitePreparationOptions(["--guide-pairs", `--candidate=${one}`]), {
    retry: false,
    packageId: undefined,
    candidates: [{ id: "55555555-5555-4555-8555-555555555555", hash: "1".repeat(64), extension: "json" }],
    guidePairs: true,
  });
  for (const args of [
    ["--guide-pairs", `--package=${packageId}`],
    ["--guide-pairs", "--with-schema-retry"],
    ["--guide-pairs", "--guide-pairs"],
    ["--guide-pairs=yes"],
  ])
    assert.throws(() => parseFinitePreparationOptions(args), /FINITE_PREPARATION_OPTIONS_INVALID/);
  // A new package for the rules' review pairs on the reviewed route is asked for by name too, alone.
  assert.deepEqual(parseFinitePreparationOptions(["--rule-pairs", `--candidate=${one}`]), {
    retry: false,
    packageId: undefined,
    candidates: [{ id: "55555555-5555-4555-8555-555555555555", hash: "1".repeat(64), extension: "json" }],
    guidePairs: false,
    rulePairs: true,
  });
  for (const option of [
    "--guide-pairs",
    "--practical-guide-pairs",
    "--reminder-inventory-pairs",
    "--with-schema-retry",
    `--package=${packageId}`,
    "--rule-pairs",
  ])
    assert.throws(
      () => parseFinitePreparationOptions(["--rule-pairs", option]),
      /FINITE_PREPARATION_OPTIONS_INVALID/,
    );
  // And one for the review pairs of templates that state the law, alone as well.
  assert.deepEqual(parseFinitePreparationOptions(["--law-template-pairs", `--candidate=${one}`]), {
    retry: false,
    packageId: undefined,
    candidates: [{ id: "55555555-5555-4555-8555-555555555555", hash: "1".repeat(64), extension: "json" }],
    guidePairs: false,
    lawTemplatePairs: true,
  });
  for (const option of [
    "--guide-pairs",
    "--practical-guide-pairs",
    "--reminder-inventory-pairs",
    "--rule-pairs",
    "--with-schema-retry",
    `--package=${packageId}`,
    "--law-template-pairs",
  ])
    assert.throws(
      () => parseFinitePreparationOptions(["--law-template-pairs", option]),
      /FINITE_PREPARATION_OPTIONS_INVALID/,
    );
  for (const args of [
    ["--approved=true"],
    ["--quota=100"],
    ["--package=anything"],
    ["--with-schema-retry", "--with-schema-retry"],
    [`--package=${packageId}`, `--package=finite-package:${"f".repeat(64)}`],
    ["--candidate=55555555-5555-4555-8555-555555555555"],
    [`--candidate=55555555-5555-4555-8555-555555555555:${"1".repeat(63)}`],
    [`--candidate=TPL-12:${"1".repeat(64)}`],
    [
      `--candidate=55555555-5555-4555-8555-555555555555:${"1".repeat(64)}`,
      `--candidate=55555555-5555-4555-8555-555555555555:${"2".repeat(64)}`,
    ],
    Array.from(
      { length: 21 },
      (_, i) => `--candidate=${String(i).padStart(8, "0")}-5555-4555-8555-555555555555:${"1".repeat(64)}`,
    ),
  ]) {
    assert.throws(() => parseFinitePreparationOptions(args), /FINITE_PREPARATION_OPTIONS_INVALID/);
  }
});
test("one frozen package projects actual publication and customer attempts without approval or network", async () => {
  const { p, q } = await mixed(),
    a = artifact(q);
  a.id = "44444444-4444-4444-8444-444444444444";
  const packet = buildFiniteDecisionPacket([p, q], [artifact(p), a], capacity, now);
  assert.equal(packet.version, 2);
  assert.equal(packet.attemptCount, 4);
  assert.equal(packet.independentPairs, 1);
  assert.equal(packet.customerCases, 1);
  assert.deepEqual(packet.laneAttempts, {
    publication: 2,
    editorial_evaluation: 0,
    checker_challenge: 0,
    customer: 2,
  });
  assert.equal(packet.worstCaseReservationNanoUsd, "1482201600");
  assert.equal(packet.ownerApproved, false);
  assert.equal(packet.enabled, false);
  assert.equal(packet.authorizesDispatch, false);
  const attempt = packet.manifests[1]!.works[1]!;
  assert.equal(attempt.evaluationCase.id, "CAI-CAND-INV-01");
  assert.equal(attempt.retryOf, q.manifest.works[0]!.key);
  assert.equal(attempt.publicationBundleHash, null);
  assert.equal(attempt.sourceFiles[0]!.path, "docs/evaluation-candidates/customer-ai.json");
  assert.equal("request" in attempt, false);
});
test("single customer attempt is not an independent review pair and exhausted capacity does not drop it", async () => {
  const { q } = await mixed(false),
    packet = buildFiniteDecisionPacket(
      [q],
      [artifact(q)],
      { ...capacity, uncommittedCapacityNanoUsd: "1" },
      now,
    );
  assert.equal(packet.independentPairs, 0);
  assert.equal(packet.customerCases, 1);
  assert.equal(packet.attemptCount, 1);
  assert.equal(packet.status, "held-capacity-unverified");
  assert.equal(packet.manifests.length, 1);
});
test("customer retry, source and request mutations fail their projection boundary", async () => {
  const { q } = await mixed();
  for (const mutate of [
    (m: typeof q.manifest) => {
      m.works[1]!.retryOf = "not-the-primary";
    },
    (m: typeof q.manifest) => {
      m.works[1]!.pair = "not-an-independent-pair";
    },
    (m: typeof q.manifest) => {
      m.works[1]!.role = "factual";
    },
    (m: typeof q.manifest) => {
      m.works[1]!.caseHash = "0".repeat(64);
    },
    (m: typeof q.manifest) => {
      m.works[1]!.bindings.sourceFiles[0]!.sha256 = "0".repeat(64);
    },
    (m: typeof q.manifest) => {
      m.works[1]!.request = {
        ...m.works[1]!.request,
        messages: [{ role: "user", content: "Altered controlled request" }],
      };
    },
  ]) {
    const m = structuredClone(q.manifest);
    mutate(m);
    const changed = finiteManifestProposal(m, expiry);
    assert.throws(
      () => buildFiniteDecisionPacket([changed], [artifact(changed)], capacity, now),
      /PREPARED_CUSTOMER_ATTEMPTS_INVALID/,
    );
  }
});
test("mixed admission selection requires the exact case and common frozen package, never a default first match", async () => {
  const { pkg, p, q } = await mixed(),
    report = { package: pkg, proposals: [p, q] };
  assert.throws(() => selectPreparedProposal(report), /EXACT_PREPARED_CANDIDATE/);
  assert.equal(selectPreparedProposal(report, "customer:CAI-CAND-INV-01"), q);
  assert.equal(selectPreparedProposal(report, p.manifest.works[0]!.bindings.candidateVersionId!), p);
  assert.throws(() => selectPreparedProposal(report, "customer:CAI-CAND-INV-02"), /EXACT_PREPARED_CANDIDATE/);
  assert.throws(
    () => selectPreparedProposal({ ...report, proposals: [q, q] }, "customer:CAI-CAND-INV-01"),
    /EXACT_PREPARED_CANDIDATE/,
  );
  q.manifest.packageId = `finite-package:${"0".repeat(64)}`;
  assert.throws(() => selectPreparedProposal(report, "customer:CAI-CAND-INV-01"), /PACKAGE_BINDING_INVALID/);
  const changed = finiteManifestProposal(q.manifest, expiry);
  assert.throws(
    () => buildFiniteDecisionPacket([p, changed], [artifact(p), artifact(changed)], capacity, now),
    /PREPARED_PACKAGES_DIFFER/,
  );
});
test("real request projection binds roles, exact versions, private artifact, costs and expiry without approval", () => {
  const p = prepared(),
    packet = buildFiniteDecisionPacket([p], [artifact(p)], capacity, now);
  assert.equal(packet.attemptCount, 2);
  assert.equal(packet.worstCaseReservationNanoUsd, "741100800");
  assert.equal(packet.enabled, false);
  assert.equal(packet.ownerApproved, false);
  assert.equal(packet.authorizesDispatch, false);
  assert.equal(packet.reviewStatus, "independent-review-pending");
  assert.equal(packet.expiresAt, new Date(expiry).toISOString());
  assert.equal(packet.manifests[0]!.works[0]!.requestHash, requestDigest(p.manifest.works[0]!.request));
  assert.equal(packet.manifests[0]!.works[0]!.sourceFiles[0]!.sha256, "c".repeat(64));
  assert.equal(packet.manifests[0]!.works[0]!.evaluationCase.id, null);
  assert.ok(!JSON.stringify(packet).includes("Controlled factual request"));
});
test("missing or depleted capacity holds the real roster instead of inventing a balance or dropping work", () => {
  const p = prepared();
  for (const room of [null, "1"]) {
    const packet = buildFiniteDecisionPacket(
      [p],
      [artifact(p)],
      { ...capacity, uncommittedCapacityNanoUsd: room },
      now,
    );
    assert.equal(packet.status, "held-capacity-unverified");
    assert.equal(packet.attemptCount, 2);
  }
  assert.throws(() => buildFiniteDecisionPacket([], [], capacity, now), /ROSTER_REQUIRED/);
});
test("changed manifests, forged private artifact hash, missing roles and expired work fail", () => {
  const p = prepared(),
    a = artifact(p);
  p.manifest.works[0]!.candidateHash = "f".repeat(64);
  assert.throws(() => buildFiniteDecisionPacket([p], [a], capacity, now), /BINDING_INVALID/);
  const fresh = prepared();
  assert.throws(
    () => buildFiniteDecisionPacket([fresh], [{ ...artifact(fresh), hash: "0".repeat(64) }], capacity, now),
    /BINDING_INVALID/,
  );
  assert.throws(
    () => buildFiniteDecisionPacket([fresh], [artifact(fresh)], capacity, new Date(expiry)),
    /EXPIRED/,
  );
  fresh.manifest.works[1]!.role = "factual";
  fresh.manifestHash = requestDigest(fresh.manifest);
  assert.throws(() => buildFiniteDecisionPacket([fresh], [artifact(fresh)], capacity, now), /PAIR_REQUIRED/);
});
test("an actual prepared roster exceeding the fixed ceiling cannot be described as ready", () => {
  const p = prepared();
  assert.throws(
    () => buildFiniteDecisionPacket(Array(41).fill(p), Array(41).fill(artifact(p)), capacity, now),
    /EXCEEDS_ALLOCATION/,
  );
});

test("an editorial case's review pair projects as one pair naming its case, and nothing else is implied", () => {
  const manifest = prepareEditorialCaseManifest(
    "EVAL-EDP-C019",
    { packageId: `finite-package:${"e".repeat(64)}` },
    now,
  );
  const p = finiteManifestProposal(manifest, expiry);
  const packet = buildFiniteDecisionPacket([p], [artifact(p)], capacity, now);
  assert.equal(packet.attemptCount, 2);
  assert.equal(packet.independentPairs, 1);
  assert.equal(packet.editorialCases, 1);
  assert.deepEqual(packet.laneAttempts, {
    publication: 0,
    editorial_evaluation: 2,
    checker_challenge: 0,
    customer: 0,
  });
  for (const w of packet.manifests[0]!.works) {
    assert.deepEqual(w.evaluationCase, {
      id: "EVAL-EDP-C019",
      hash: manifest.works[0]!.caseHash,
      corpus: "editorial",
    });
    assert.equal(w.publicationBundleHash, null);
  }
  assert.equal(packet.worstCaseReservationNanoUsd, (370550400n * 2n).toString());
  assert.match(packet.excludedWork, /^Only the listed editorial case pairs are executable/);
  assert.equal(packet.ownerApproved, false);
  // A pair whose two works name different cases is not one review pair.
  const split = structuredClone(manifest);
  split.works[1]!.caseHash = "f".repeat(64);
  const q = finiteManifestProposal(split, expiry);
  assert.throws(() => buildFiniteDecisionPacket([q], [artifact(q)], capacity, now), /PAIR_REQUIRED/);
});
