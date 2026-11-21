import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareOperationalFiniteManifest,
  finiteManifestProposal,
  type OperationalFiniteInput,
} from "./inference-manifest";
import { additionalInferenceAllocation, requestDigest } from "./inference-budget";

const now = new Date("2026-11-14T22:00:00.000Z");
function input(): OperationalFiniteInput {
  const request = (role: string) => ({
    model: "gpt-5.4-mini",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: `synthetic ${role} review` },
      { role: "user", content: "synthetic blank form" },
    ],
  });
  return {
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
    sourceFiles: [],
    plan: {
      manifest: {
        candidateHash: "a".repeat(64),
        preparedAt: "2026-11-14T21:59:00.000Z",
        expiresAt: "2026-11-14T22:59:00.000Z",
        status: "mechanically_planned_not_reserved",
      },
      artifact: { id: "22222222-2222-4222-8222-222222222222", hash: "c".repeat(64), extension: "json" },
      entries: [
        { role: "factual", request: request("factual") },
        { role: "challenge", request: request("challenge") },
      ],
    },
  };
}

test("preparation binds distinct exact requests to one pair and fixed additional allocation", () => {
  const value = input(),
    manifest = prepareOperationalFiniteManifest(value, now);
  assert.equal(manifest.version, 2);
  assert.deepEqual(manifest.allocation, additionalInferenceAllocation);
  assert.equal(manifest.works.length, 2);
  assert.equal(manifest.works[0]!.pair, manifest.works[1]!.pair);
  assert.notEqual(manifest.works[0]!.key, manifest.works[1]!.key);
  assert.equal(manifest.works[0]!.bindings.candidateVersionId, value.candidateVersionId);
  assert.deepEqual(manifest.works[0]!.bindings.operationalPlan, value.plan.artifact);
  for (const work of manifest.works)
    assert.deepEqual(work.bindings.candidateArtifact, value.candidateArtifact);
  assert.equal(manifest.works[1]!.caseHash, value.bundleHash);
  assert.notEqual(requestDigest(manifest.works[0]!.request), requestDigest(manifest.works[1]!.request));
});

test("proposal discloses exact two-attempt reservation and never authorizes dispatch", () => {
  const value = input(),
    proposal = finiteManifestProposal(
      prepareOperationalFiniteManifest(value, now),
      value.plan.manifest.expiresAt,
    );
  assert.equal(proposal.worstCaseReservationNanoUsd, "741100800");
  assert.equal(proposal.allocationCapNanoUsd, "30000000000");
  assert.equal(proposal.attemptCount, 2);
  assert.equal(proposal.pairCount, 1);
  assert.equal(proposal.ownerApproved, false);
  assert.equal(proposal.enabled, false);
  assert.equal(proposal.providerCalls, 0);
  assert.equal(proposal.historicalChargesIncluded, false);
  assert.equal(proposal.automaticRetries, 0);
  assert.equal(proposal.approvalRequiredForExactManifest, true);
  assert.equal(proposal.publicationAccepted, false);
});

test("stale/future/held preparation cannot produce an approvable roster", () => {
  for (const mutate of [
    (x: OperationalFiniteInput) => {
      x.plan.manifest.expiresAt = now.toISOString();
    },
    (x: OperationalFiniteInput) => {
      x.plan.manifest.preparedAt = "2026-11-14T22:01:00.000Z";
    },
    (x: OperationalFiniteInput) => {
      x.plan.manifest.expiresAt = "invalid";
    },
    (x: OperationalFiniteInput) => {
      x.plan.manifest.status = "input_size_held";
    },
  ]) {
    const value = input();
    mutate(value);
    assert.throws(() => prepareOperationalFiniteManifest(value, now), /FINITE_PREPARATION_/);
  }
});

test("duplicate reviewer request or role cannot claim independent two-role work", () => {
  const sameRequest = input();
  sameRequest.plan.entries[1]!.request = structuredClone(sameRequest.plan.entries[0]!.request);
  assert.throws(() => prepareOperationalFiniteManifest(sameRequest, now), /PAIR_INVALID/);
  const sameRole = input();
  sameRole.plan.entries[1]!.role = "factual";
  assert.throws(() => prepareOperationalFiniteManifest(sameRole, now), /PAIR_INVALID/);
});

test("changed candidate binding, path traversal and raised output budget are held", () => {
  const wrongCandidate = input();
  wrongCandidate.plan.manifest.candidateHash = "d".repeat(64);
  assert.throws(() => prepareOperationalFiniteManifest(wrongCandidate, now), /BINDING_INVALID/);
  const path = input();
  path.sourceFiles = [{ path: "docs/../secrets", sha256: "d".repeat(64) }];
  assert.throws(() => prepareOperationalFiniteManifest(path, now), /SOURCE_INVALID/);
  const raised = input();
  raised.plan.entries[0]!.request.max_completion_tokens = 16384;
  assert.throws(() => prepareOperationalFiniteManifest(raised, now), /REQUEST_INVALID/);
});

test("the saved manifest owns its request and source structures", () => {
  const value = input();
  value.sourceHashes = ["d".repeat(64)];
  value.sourceFiles = [{ path: "docs/source.json", sha256: "d".repeat(64) }];
  const manifest = prepareOperationalFiniteManifest(value, now),
    before = requestDigest(manifest);
  (value.plan.entries[0]!.request.messages as { role: string; content: string }[])[0]!.content = "changed";
  value.sourceHashes[0] = "e".repeat(64);
  value.sourceFiles[0]!.path = "docs/changed.json";
  value.plan.artifact.hash = "f".repeat(64);
  assert.equal(requestDigest(manifest), before);
});

test("changing a plan artifact creates distinct work identity without implicit retry", () => {
  const value = input(),
    first = prepareOperationalFiniteManifest(value, now);
  value.plan.artifact.hash = "d".repeat(64);
  const changed = prepareOperationalFiniteManifest(value, now);
  assert.notEqual(first.works[0]!.key, changed.works[0]!.key);
  assert.notEqual(requestDigest(first), requestDigest(changed));
  assert.equal(changed.works.length, 2);
});
test("authorship file digests join the source set and changing those bytes changes work identity", () => {
  const value = input();
  value.sourceHashes = ["d".repeat(64)];
  value.sourceFiles = [{ path: "docs/original.md", sha256: "e".repeat(64) }];
  const first = prepareOperationalFiniteManifest(value, now);
  assert.deepEqual(first.works[0]!.sourceHashes, ["d".repeat(64), "e".repeat(64)]);
  value.sourceFiles[0]!.sha256 = "f".repeat(64);
  const changed = prepareOperationalFiniteManifest(value, now);
  assert.notEqual(changed.works[0]!.key, first.works[0]!.key);
  assert.deepEqual(changed.works[0]!.sourceHashes, ["d".repeat(64), "f".repeat(64)]);
});
test("the prepared candidate's artifact is required, exact and part of work identity", () => {
  for (const mutate of [
    (x: OperationalFiniteInput) => {
      delete (x as Partial<OperationalFiniteInput>).candidateArtifact;
    },
    (x: OperationalFiniteInput) => {
      x.candidateArtifact.id = "not-an-artifact";
    },
    (x: OperationalFiniteInput) => {
      x.candidateArtifact.hash = "short";
    },
    (x: OperationalFiniteInput) => {
      (x.candidateArtifact as { extension: string }).extension = "pdf";
    },
    (x: OperationalFiniteInput) => {
      x.candidateArtifact.templateId = "GUIDE-01";
    },
  ]) {
    const value = input();
    mutate(value);
    assert.throws(() => prepareOperationalFiniteManifest(value, now), /FINITE_PREPARATION_BINDING_INVALID/);
  }
  const value = input(),
    first = prepareOperationalFiniteManifest(value, now);
  value.candidateArtifact.hash = "8".repeat(64);
  const changed = prepareOperationalFiniteManifest(value, now);
  assert.notEqual(changed.works[0]!.key, first.works[0]!.key);
  assert.notEqual(changed.works[0]!.pair, first.works[0]!.pair);
  // The manifest keeps its own copy of the binding.
  value.candidateArtifact.templateId = "TPL-13";
  assert.equal(changed.works[0]!.bindings.candidateArtifact!.templateId, "TPL-12");
});
test("a prepared candidate may be a template or a guide, named by its exact ID", () => {
  for (const id of ["TPL-07", "TPL-12", "GUD-01", "GUD-30"]) {
    const value = input();
    value.candidateArtifact.templateId = id;
    const manifest = prepareOperationalFiniteManifest(value, now);
    assert.deepEqual(
      manifest.works.map((w) => [w.lane, w.bindings.candidateArtifact!.templateId]),
      [
        ["publication", id],
        ["publication", id],
      ],
    );
  }
  for (const id of ["GUD-1", "GUD-001", "GUIDE-C01", "gud-01", "GUD-01 ", "RULE-01", ""]) {
    const value = input();
    value.candidateArtifact.templateId = id;
    assert.throws(() => prepareOperationalFiniteManifest(value, now), /FINITE_PREPARATION_BINDING_INVALID/);
  }
});
