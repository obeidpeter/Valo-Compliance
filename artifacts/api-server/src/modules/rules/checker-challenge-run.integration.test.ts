import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * RUL-008 (docs/architecture/checker-scenarios.md, slice 2b): the challenge of a rule's frozen
 * scenarios goes the whole route a real run would. The business-name rule is released on a synthetic
 * owner's sign-off; a checker-challenge package is approved in an isolated ledger schema; the rule's
 * 20 challenges are prepared, admitted and dispatched through the real dispatcher, ledger, binding
 * checks and managed SDK transport, over the integration's own client, to a local destination that
 * answers each with a synthetic answer. Nothing reaches the provider and nothing is spent. The
 * answers are synthetic, so this is evidence for the route only, never for any scenario.
 */
test(
  "the challenges of a released rule's scenarios are admitted under a checker-challenge package, run one approved work at a time and kept as answers that accept nothing, and none runs once the release is withdrawn",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    const received: string[] = [];
    const answer = {
      expectedResultSupported: true,
      resultTheSourcesSupport: "Likely relevant",
      basis: [{ sourceId: "synthetic-source", words: "Synthetic controlled destination" }],
      reasoning: "Synthetic controlled answer.",
      unresolved: [],
    };
    const destination = createServer((request, response) => {
      received.push(`${request.method} ${request.url}`);
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: `controlled-${randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gpt-5.4-mini",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: JSON.stringify(answer) },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
          }),
        );
      });
    });
    await new Promise<void>((done) => destination.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(destination.address() as AddressInfo).port}/v1`;
    // Set before the integration's client is first loaded, which is only below.
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = base;
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "controlled-destination-not-a-credential";
    const previousMode = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const { pool } = await import("@workspace/db");
    const [
      { InferenceBudgetStore },
      { FiniteInferenceDispatcher },
      { emptyBudget, inferenceProposal, requestDigest },
      {
        allocationPackageId,
        finitePackagePreparers,
        prepareFiniteAllocationPackage,
        registerPreparedInferenceSubmanifest,
      },
      { withBoundInferenceDispatcher },
      { createManagedSDKTransport },
      { assertFiniteWorkBindings },
      { ownerRuleCandidates },
      { signRuleForTest },
      { prepareCheckerChallengeManifest },
      { executeCheckerChallenges },
      { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS },
    ] = await Promise.all([
      import("../ai/inference-budget-store"),
      import("../ai/inference-batch-dispatch"),
      import("../ai/inference-budget"),
      import("../ai/inference-allocation-package"),
      import("../ai/managed-inference"),
      import("../ai/managed-sdk-transport"),
      import("../ai-lanes"),
      import("../editorial/owner-rule-candidates"),
      import("../../test-support/owner-rule-signing"),
      import("./checker-challenge"),
      import("./checker-challenge-run"),
      import("../../test-support/database-functions"),
    ]);
    const schema = `checker_challenge_${randomUUID().replaceAll("-", "")}`;
    const c = await pool.connect();
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      for (const file of ["0018_inference_budget.sql", "0020_inference_batch_authorization.sql"]) {
        const ddl = await readFile(new URL(`../../../../../lib/db/drizzle/${file}`, import.meta.url), "utf8");
        await c.query(ddl.replaceAll("--> statement-breakpoint", ""));
      }
      await copyDatabaseFunctions(c, schema, INFERENCE_LEDGER_FUNCTIONS);
    } finally {
      await c.query("RESET search_path");
      c.release();
    }
    const ruleId = "cac-business-name-814";
    const candidate = ownerRuleCandidates.find((r) => r.rule.id === ruleId)!;
    const signed = await signRuleForTest(candidate.rule, candidate.scenarios);
    let withdrawn = false;
    try {
      const store = new InferenceBudgetStore(pool, schema, "additional-new");
      await store.mutate("isolated-fixture-reset", () => ({
        state: { ...emptyBudget(), priorUseReconciled: true },
        value: null,
      }));
      // A synthetic owner approval of a checker-challenge package, in this isolated schema only.
      const pkg = await prepareFiniteAllocationPackage(new Date(), finitePackagePreparers.checkerChallenges),
        packageId = allocationPackageId(pkg),
        expires = new Date(Date.now() + 3600000).toISOString();
      await pool.query(
        `INSERT INTO "${schema}".valo_inference_batches
        (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
        VALUES($1,$2,$3,$4,true,'controlled-owner-fixture','controlled-package-approval',now(),$5)`,
        [packageId, requestDigest(inferenceProposal), requestDigest(pkg), JSON.stringify(pkg), expires],
      );
      const manifest = await prepareCheckerChallengeManifest(ruleId, { packageId });
      assert.equal(manifest.works.length, 20);
      const admitted = await registerPreparedInferenceSubmanifest(
        store,
        manifest,
        expires,
        assertFiniteWorkBindings,
      );

      // The production adapter: the managed SDK transport over the integration's own client.
      const { openai } = await import("@workspace/integrations-openai-ai-server");
      assert.equal(openai.baseURL, base, "the client must name the controlled destination");
      const dispatcher = new FiniteInferenceDispatcher(
        store,
        createManagedSDKTransport(async () => openai as never),
        assertFiniteWorkBindings,
      );
      const kept: Record<string, unknown>[] = [];
      const put = async (bytes: Buffer, extension: "json" | "pdf" | "docx") => {
        kept.push(JSON.parse(bytes.toString()) as Record<string, unknown>);
        return { id: randomUUID(), hash: createHash("sha256").update(bytes).digest("hex"), extension };
      };
      const run = () =>
        withBoundInferenceDispatcher(dispatcher, () =>
          executeCheckerChallenges(admitted.batchId, manifest.works, put),
        );

      // Each of the 20 goes out once, as its own approved work, and its answer is kept against it.
      const answers = await run();
      assert.deepEqual(
        answers.map((a) => a.outcome),
        Array(20).fill("completed"),
      );
      assert.equal(received.length, 20);
      assert.ok(received.every((line) => line === "POST /v1/chat/completions"));
      assert.deepEqual(
        kept.map((r) => [r.kind, r.caseId, r.releaseId, r.accepted]),
        manifest.works.map((w) => [
          "checker-challenge-answer-v1",
          w.bindings!.caseId,
          w.bindings!.candidateVersionId,
          false,
        ]),
      );
      assert.ok(kept.every((r) => requestDigest(r.output) === requestDigest(answer)));
      const results = (
        await pool.query(`SELECT results FROM "${schema}".valo_inference_batches WHERE id=$1`, [
          admitted.batchId,
        ])
      ).rows[0]!.results as Record<string, unknown>;
      assert.deepEqual(Object.keys(results).sort(), manifest.works.map((w) => w.key).sort());

      // A work already answered is not sent again: while its answer is fresh, the dispatcher hands
      // back the one it retained, and the record says nothing went out.
      const again = await run();
      assert.equal(received.length, 20, "nothing is sent for a work already answered");
      assert.deepEqual(
        again.map((a) => [a.outcome, a.providerResponseId]),
        answers.map((a) => ["completed", a.providerResponseId]),
      );
      assert.equal(kept.length, 40);
      assert.ok(
        kept
          .slice(20)
          .every((r) => r.kind === "checker-challenge-answer-v1" && r.outboundAttempted === false),
      );

      // Once the release is withdrawn, no admitted challenge of it passes its binding check, so
      // none is sent or answered from what was retained, and none can be prepared.
      await signed.withdraw("Synthetic withdrawal so no challenge of this release runs again.");
      withdrawn = true;
      const afterWithdrawal = await run();
      assert.equal(received.length, 20, "nothing is sent once the release is withdrawn");
      assert.ok(afterWithdrawal.every((a) => a.outcome === "failed" && a.providerResponseId === null));
      assert.equal(kept.length, 60);
      assert.ok(
        kept
          .slice(40)
          .every(
            (r) =>
              r.kind === "checker-challenge-failure-v1" &&
              r.code === "CANDIDATE_UNAVAILABLE_OR_STALE" &&
              r.outboundAttempted === false,
          ),
      );
      await assert.rejects(prepareCheckerChallengeManifest(ruleId, { packageId }), /RELEASE_UNAVAILABLE/);
      assert.equal(received.length, 20);
    } finally {
      if (!withdrawn) await signed.withdraw("Synthetic withdrawal after a failed challenge run test.");
      process.env.NODE_ENV = previousMode;
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
      await new Promise<void>((done) => destination.close(() => done()));
    }
  },
);
