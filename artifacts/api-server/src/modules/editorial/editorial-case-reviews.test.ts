import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFiniteWorkShape, requestDigest } from "../ai";
import { buildEditorialCaseCandidates, buildableEditorialCases } from "./editorial-case-candidates";
import {
  editorialCaseCandidate,
  editorialCaseReviewRequests,
  editorialCaseVersionId,
  prepareEditorialCaseManifest,
  preparableEditorialCases,
  controlledFailureEditorialCases,
} from "./editorial-case-reviews";
import { reviewEvidenceGuidance, reviewResponseFormat, reviewRoleInstructions } from "./operational-review";

const now = new Date("2026-11-20T18:00:00.000Z");
const manifests = preparableEditorialCases.map((id) => prepareEditorialCaseManifest(id, {}, now));

test("prepares one factual and one challenge request for each of the 12 preparable cases, within the lane's bounds", () => {
  assert.equal(manifests.length, 12);
  for (const [i, m] of manifests.entries()) {
    const id = preparableEditorialCases[i]!;
    assert.equal(m.preparedAt, now.toISOString());
    assert.deepEqual(
      m.works.map((w) => w.role),
      ["factual", "challenge"],
    );
    const [factual, challenge] = m.works;
    assert.equal(factual!.pair, challenge!.pair);
    assert.notEqual(requestDigest(factual!.request), requestDigest(challenge!.request));
    for (const w of m.works) {
      assertFiniteWorkShape(w);
      assert.equal(w.lane, "editorial_evaluation");
      assert.equal(w.bindings.corpus, "editorial");
      assert.equal(w.bindings.caseId, id);
      assert.equal(w.request.model, "gpt-5.4-mini");
      assert.equal(w.request.max_completion_tokens, 8192);
    }
  }
  for (const id of preparableEditorialCases)
    for (const entry of editorialCaseReviewRequests(editorialCaseCandidate(id), now.toISOString()))
      assert.ok(entry.meter.withinInputCeiling, `${id} ${entry.role} fits the input bound`);
});

test("each reviewer gets a publication review's instructions and answer schema, with the case's real evidence", () => {
  for (const id of preparableEditorialCases) {
    const c = editorialCaseCandidate(id);
    for (const entry of editorialCaseReviewRequests(c, now.toISOString())) {
      const [system, user] = entry.request.messages as { role: string; content: string }[];
      assert.ok(
        system!.content.startsWith(reviewRoleInstructions(entry.role, c.candidate, now.toISOString())),
      );
      assert.ok(system!.content.endsWith(reviewEvidenceGuidance));
      assert.deepEqual(entry.request.response_format, reviewResponseFormat(c.candidate));
      const input = JSON.parse(user!.content);
      assert.deepEqual(input.candidate, c.candidate);
      assert.deepEqual(input.sources ?? [], c.sources);
      assert.equal(input.rights.status, "not_cleared");
      assert.equal(input.exports.rendered, false);
      assert.equal(
        input.provenance.version,
        c.candidateEdited
          ? "This version contains later edits to the retained text, which are not separately attributed."
          : "This version is the retained text.",
      );
    }
  }
});

test("what a reviewer sees never names the case, the corpus or its expected outcome", () => {
  for (const m of manifests)
    for (const w of m.works) {
      const seen = JSON.stringify(w.request.messages);
      assert.doesNotMatch(seen, /EVAL-EDP-C\d{3}|evaluation-candidates|expectedOutcome|inputMutation/);
      assert.doesNotMatch(seen, /criticalFailure|requiredBehavior|editorial case|evaluation case/i);
    }
});

test("a manifest is rebuilt identically at its preparation time, and its pair differs at another", () => {
  for (const [i, m] of manifests.entries()) {
    const id = preparableEditorialCases[i]!;
    assert.deepEqual(prepareEditorialCaseManifest(id, {}, now), m);
    const later = prepareEditorialCaseManifest(id, {}, new Date(now.getTime() + 60_000));
    assert.notEqual(later.works[0]!.pair, m.works[0]!.pair);
    assert.equal(
      prepareEditorialCaseManifest(id, { packageId: "finite-package:x" }, now).packageId,
      "finite-package:x",
    );
  }
});

test("each work names its candidate by a stable UUID and binds its sources and the pinned files", () => {
  const ids = new Set<string>();
  for (const [i, m] of manifests.entries()) {
    const c = editorialCaseCandidate(preparableEditorialCases[i]!);
    const versionId = editorialCaseVersionId(c);
    assert.match(versionId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    ids.add(versionId);
    for (const w of m.works) {
      assert.equal(w.bindings.candidateVersionId, versionId);
      assert.equal(w.candidateHash, c.candidate.hash);
      assert.equal(w.caseHash, c.caseHash);
      assert.deepEqual(
        w.sourceHashes,
        [
          ...new Set([...c.sources.map((s) => s.hash), ...w.bindings.sourceFiles.map((f) => f.sha256)]),
        ].sort(),
      );
    }
  }
  assert.equal(ids.size, 12);
});

test("cases that need a real prior hold or unretained text cannot be prepared, and C041 only for a controlled failure", () => {
  const { notBuilt } = buildEditorialCaseCandidates();
  for (const id of ["EVAL-EDP-C060", "EVAL-EDP-C001", ...notBuilt.map((c) => c.caseId)])
    assert.throws(() => prepareEditorialCaseManifest(id, {}, now), /EDITORIAL_CASE_NOT_PREPARABLE/);
  // C041's pair is prepared like C004's, its candidate unchanged, but it is listed apart: the
  // operator runner refuses it, and only the controlled-failure test runs it.
  assert.deepEqual([...controlledFailureEditorialCases], ["EVAL-EDP-C041"]);
  const c041 = prepareEditorialCaseManifest("EVAL-EDP-C041", {}, now);
  assert.equal(c041.works[0]!.candidateHash, editorialCaseCandidate("EVAL-EDP-C004").candidate.hash);
  assert.deepEqual(
    Object.keys(buildableEditorialCases).filter(
      (id) => !(preparableEditorialCases as readonly string[]).includes(id),
    ),
    ["EVAL-EDP-C041", "EVAL-EDP-C060"],
  );
});
