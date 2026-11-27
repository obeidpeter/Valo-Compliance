import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ownerConfirmedChecks } from "@workspace/valo-core";

// RUL-008 (docs/architecture/checker-scenarios.md, slice 2): the challenge requests for the frozen
// corpus's cases, built from release rows made of the four rules prepared as the owner's sign-off
// would release them. In memory: nothing is stored, released or sent to a model.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const signoff = await import("../editorial/owner-rule-signoff");
const { capturedGuidePassages, guideAmendmentRecords, guidancePolicy } = await import("../publication");
const { ownerRuleTextCopies } = await import("../../test-support/owner-rule-texts");
const { assertFiniteWorkShape, requestDigest } = await import("../ai");
const { CHECKER_CORPUS_PATH, checkerChallengeManifest, checkerChallengeVerdictSchema } =
  await import("./checker-challenge");

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const corpusBytes = readFileSync(`${root}${CHECKER_CORPUS_PATH}`);
const corpus = JSON.parse(corpusBytes.toString("utf8")) as { cases: Record<string, unknown>[] };
const { now, captures } = await ownerRuleTextCopies(signoff.ownerRuleCandidates[0]!.scenarios[0]!.asOfDate);
const { policy } = await guidancePolicy();
const releases = signoff.ownerRuleCandidates.map((candidate) => {
  const prepared = signoff.prepareOwnerRule(candidate, {
    version: 1,
    captures,
    passages: capturedGuidePassages(captures),
    records: guideAmendmentRecords,
    policy,
    confirmed: ownerConfirmedChecks,
    now,
  });
  assert.deepEqual(prepared.holds, [], candidate.rule.id);
  return {
    id: randomUUID(),
    ruleId: prepared.rule.id,
    version: prepared.rule.version,
    status: "published",
    rule: prepared.rule,
    publicationBundle: prepared.bundle,
    manifestHash: prepared.rule.manifestHash,
  };
});
const manifests = releases.map((release) => checkerChallengeManifest(release, {}, now));
const works = manifests.flatMap((m) => m.works);

test("each of the 80 corpus cases gets one challenge request for the lane, bound to its case, its rule's release and sources, the corpus file and the moment it was prepared", () => {
  assert.deepEqual(
    manifests.map((m) => m.works.length),
    [20, 20, 20, 20],
  );
  assert.equal(new Set(works.map((w) => w.key)).size, 80);
  const corpusHash = createHash("sha256").update(corpusBytes).digest("hex");
  for (const [i, manifest] of manifests.entries()) {
    const release = releases[i]!;
    const bundle = release.publicationBundle;
    assert.equal(manifest.preparedAt, now.toISOString());
    for (const work of manifest.works) {
      assertFiniteWorkShape(work);
      const row = corpus.cases.find((c) => c.caseID === work.bindings!.caseId)!;
      assert.equal(work.lane, "checker_challenge");
      assert.equal(work.role, "challenge");
      assert.equal(work.pair, null);
      assert.equal(work.caseHash, requestDigest(row));
      assert.equal(work.candidateHash, bundle.candidate.hash);
      assert.deepEqual(
        work.sourceHashes,
        [...new Set([...bundle.sources.map((s) => s.hash), corpusHash])].sort(),
      );
      assert.deepEqual(work.bindings, {
        candidateVersionId: release.id,
        corpus: "checker",
        caseId: row.caseID,
        sourceFiles: [{ path: CHECKER_CORPUS_PATH, sha256: corpusHash }],
        historicalCutoff: now.toISOString(),
      });
      assert.match(work.key, new RegExp(`^checker-challenge:${String(row.caseID)}:[a-f0-9]{64}:attempt-1$`));
    }
  }
});

test("a challenge request gives the model the case's answers, the rule's passages, the expected and the live result, asks only whether the passages support the expected one, and fits the lane's bound", () => {
  for (const work of works) {
    const request = work.request as {
      model: string;
      max_completion_tokens: number;
      messages: { role: string; content: string }[];
      response_format: { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
    };
    assert.equal(request.model, "gpt-5.4-mini");
    assert.equal(request.max_completion_tokens, 8192);
    assert.deepEqual(
      request.messages.map((m) => m.role),
      ["system", "user"],
    );
    assert.match(request.messages[0]!.content, /Read only the source passages given/);
    assert.match(request.messages[0]!.content, /not legal, tax or regulatory advice, and it accepts nothing/);
    const body = JSON.parse(request.messages[1]!.content) as {
      scenario: { id: string; answers: Record<string, unknown> };
      rule: { passages: { id: string; hash: string; text: string }[]; quotes: unknown[] };
      expectedResult: { applicability: string; label: string };
      checkResult: { outcome: string };
    };
    assert.equal(body.scenario.id, work.bindings!.caseId);
    assert.equal(Object.keys(body.scenario.answers).length, 1);
    assert.ok(body.rule.passages.length >= 1 && body.rule.passages.every((p) => p.text.length > 0));
    assert.deepEqual(
      body.rule.passages.map((p) => p.hash).sort(),
      work.sourceHashes.filter((h) => body.rule.passages.some((p) => p.hash === h)),
    );
    assert.ok(body.rule.quotes.length >= 1);
    assert.ok(
      ["held", "likely_relevant", "not_indicated", "more_information_needed", "may_apply"].includes(
        body.expectedResult.applicability,
      ),
    );
    assert.ok(["result", "held", "refused"].includes(body.checkResult.outcome));
    assert.deepEqual(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    assert.ok(Buffer.byteLength(JSON.stringify(request), "utf8") + 1024 <= 32000, work.key);
  }
  // The six cases that test a hold give the model the check's hold or its refusal.
  const held = works
    .map((w) => JSON.parse((w.request as { messages: readonly { content: string }[] }).messages[1]!.content))
    .filter((b) => b.expectedResult.applicability === "held");
  assert.equal(held.length, 6);
  assert.ok(held.every((b) => b.checkResult.outcome !== "result"));
});

test("the model's answer is held to its strict schema: a verdict, the result the passages support, the deciding words and what stays unresolved, and nothing else", () => {
  const answer = {
    expectedResultSupported: false,
    resultTheSourcesSupport: "More information needed",
    basis: [{ sourceId: "ndpa-2", words: "domiciled, resident in, or operating in Nigeria" }],
    reasoning: "The answers do not say where the controller is domiciled or resident.",
    unresolved: ["Where the business is domiciled."],
  };
  assert.deepEqual(checkerChallengeVerdictSchema.parse(answer), answer);
  assert.equal(checkerChallengeVerdictSchema.safeParse({ ...answer, accepted: true }).success, false);
  assert.equal(
    checkerChallengeVerdictSchema.safeParse({ ...answer, resultTheSourcesSupport: "Compliant" }).success,
    false,
  );
  const { reasoning: _dropped, ...partial } = answer;
  assert.equal(checkerChallengeVerdictSchema.safeParse(partial).success, false);
});

test("built again from the same release at the same moment the requests are identical, and any other moment, release or bundle gives others or is refused", () => {
  for (const [i, release] of releases.entries())
    assert.equal(requestDigest(checkerChallengeManifest(release, {}, now)), requestDigest(manifests[i]));
  const later = checkerChallengeManifest(releases[0]!, {}, new Date(+now + 60_000));
  assert.ok(later.works.every((w, i) => w.key !== manifests[0]!.works[i]!.key));
  const other = checkerChallengeManifest({ ...releases[0]!, id: randomUUID() }, {}, now);
  assert.ok(other.works.every((w, i) => requestDigest(w) !== requestDigest(manifests[0]!.works[i])));
  // A package's id names the manifest, never a work, so admission can rebuild each work alone.
  const packaged = checkerChallengeManifest(releases[0]!, { packageId: "synthetic-package" }, now);
  assert.equal(packaged.packageId, "synthetic-package");
  assert.equal(requestDigest(packaged.works), requestDigest(manifests[0]!.works));
  const release = releases[0]!;
  assert.throws(
    () => checkerChallengeManifest({ ...release, status: "superseded" }, {}, now),
    /RELEASE_INVALID/,
  );
  assert.throws(
    () => checkerChallengeManifest({ ...release, manifestHash: "f".repeat(64) }, {}, now),
    /RELEASE_INVALID/,
  );
  assert.throws(
    () => checkerChallengeManifest({ ...release, ruleId: "ntaa-11-company-return" }, {}, now),
    /RELEASE_INVALID/,
  );
  const bundle = release.publicationBundle;
  const altered = {
    ...bundle,
    sources: bundle.sources.map((s) => ({ ...s, text: "Altered text without the rule's quote." })),
  };
  assert.throws(
    () => checkerChallengeManifest({ ...release, publicationBundle: altered }, {}, now),
    /RELEASE_INVALID/,
  );
  const reviewBy = Date.parse((release.rule as { reviewBy: string }).reviewBy);
  assert.throws(() => checkerChallengeManifest(release, {}, new Date(reviewBy)), /RELEASE_STALE/);
  assert.throws(
    () => checkerChallengeManifest(release, {}, new Date(Number.NaN)),
    /PREPARATION_TIME_INVALID/,
  );
});

test("a checker-challenge package admits exactly the challenges of the corpus's scenarios, and no other package admits them", async () => {
  const { assertWorkPackageMembership, finitePackagePreparers, prepareFiniteAllocationPackage } =
    await import("../ai");
  const pkg = await prepareFiniteAllocationPackage(now, finitePackagePreparers.checkerChallenges);
  assert.ok(pkg.holds.some((h) => h.startsWith("Supported checker challenges")));
  assert.ok(pkg.holds.some((h) => h.includes("accepts nothing and is not professional review")));
  const checker = pkg.corpora.find((c) => c.name === "checker")!;
  assert.equal(checker.cases.length, 80);
  for (const work of works) {
    assert.equal(checker.cases.find((c) => c.id === work.bindings!.caseId)?.hash, work.caseHash);
    assertWorkPackageMembership(work, pkg, null);
  }
  const [work] = works;
  assert.throws(
    () => assertWorkPackageMembership({ ...work!, caseHash: "0".repeat(64) }, pkg, null),
    /WORK_OUTSIDE_PACKAGE/,
  );
  assert.throws(
    () => assertWorkPackageMembership(work!, pkg, "TPL-01"),
    /PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE/,
  );
  for (const other of [finitePackagePreparers.editorialCases, finitePackagePreparers.templatePairs])
    assert.throws(
      () => assertWorkPackageMembership(work!, { ...pkg, supportedPreparers: other }, null),
      /WORK_OUTSIDE_PACKAGE/,
    );
  // An editorial case's pair is not admitted by a checker-challenge package.
  const { prepareEditorialCaseManifest } = await import("../editorial");
  const editorial = prepareEditorialCaseManifest("EVAL-EDP-C004", {}, now).works[0]!;
  assert.throws(() => assertWorkPackageMembership(editorial, pkg, null), /WORK_OUTSIDE_PACKAGE/);
});
