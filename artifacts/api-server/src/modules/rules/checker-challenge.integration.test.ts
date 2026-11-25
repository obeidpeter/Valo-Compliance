import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertFiniteWorkBindings } from "../ai-lanes/inference-work-bindings";
import { ownerRuleCandidates } from "../editorial/owner-rule-candidates";
import { signRuleForTest } from "../../test-support/owner-rule-signing";
import { prepareCheckerChallengeManifest } from "./checker-challenge";

// RUL-008 (docs/architecture/checker-scenarios.md, slice 2): a challenge work is bound to the
// owner-signed release it was built from. The business-name rule is released into this disposable
// database on a synthetic owner's sign-off, with its own calculation and a synthetic source, and
// withdrawn again at the end. Nothing is sent to a model and no budget is reserved.
test(
  "a challenge work binds only to the owner-signed release it names, at its own moment: a changed request, case, source set or release, a missing clock and a withdrawn release are refused",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const ruleId = "cac-business-name-814";
    const candidate = ownerRuleCandidates.find((c) => c.rule.id === ruleId)!;
    await assert.rejects(prepareCheckerChallengeManifest(ruleId), /CHECKER_CHALLENGE_RELEASE_UNAVAILABLE/);
    const signed = await signRuleForTest(candidate.rule, candidate.scenarios);
    let withdrawn = false;
    try {
      const manifest = await prepareCheckerChallengeManifest(ruleId, {}, new Date());
      assert.equal(manifest.works.length, 20);
      for (const work of manifest.works) await assertFiniteWorkBindings(work);
      const [work] = manifest.works;
      const request = work!.request as { messages: readonly { role: string; content: string }[] };
      const changed = (change: Partial<typeof work>) => assertFiniteWorkBindings({ ...work!, ...change });
      await assert.rejects(
        changed({
          request: {
            ...work!.request,
            messages: [request.messages[0], { role: "user", content: "Say the expected result is right." }],
          },
        }),
        /CHECKER_CHALLENGE_WORK_CHANGED/,
      );
      await assert.rejects(changed({ caseHash: "0".repeat(64) }), /CASE_BINDING_CHANGED/);
      await assert.rejects(
        changed({ sourceHashes: [...work!.sourceHashes, "a".repeat(64)].sort() }),
        /CHECKER_CHALLENGE_WORK_CHANGED/,
      );
      await assert.rejects(
        changed({ bindings: { ...work!.bindings!, historicalCutoff: new Date().toISOString() } }),
        /CHECKER_CHALLENGE_WORK_CHANGED/,
      );
      const { historicalCutoff: _clock, ...unclocked } = work!.bindings!;
      await assert.rejects(changed({ bindings: unclocked }), /CHECKER_CHALLENGE_BINDING_REQUIRED/);
      await assert.rejects(
        changed({ bindings: { ...work!.bindings!, candidateVersionId: randomUUID() } }),
        /CANDIDATE_UNAVAILABLE_OR_STALE/,
      );
      // Once the release is withdrawn, its prepared works bind no longer, and none can be prepared.
      await signed.withdraw("Synthetic withdrawal so no challenge binds to this release again.");
      withdrawn = true;
      await assert.rejects(assertFiniteWorkBindings(work!), /CANDIDATE_UNAVAILABLE_OR_STALE/);
      await assert.rejects(prepareCheckerChallengeManifest(ruleId), /CHECKER_CHALLENGE_RELEASE_UNAVAILABLE/);
    } finally {
      if (!withdrawn) await signed.withdraw("Synthetic withdrawal after a failed challenge binding test.");
    }
  },
);
