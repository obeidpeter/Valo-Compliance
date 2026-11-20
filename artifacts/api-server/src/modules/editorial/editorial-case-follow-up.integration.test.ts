import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * EDP-010, case C060 (decision 0015): C060 revises C018's candidate after a real hold, so its pair is
 * prepared, admitted and run only while C018's latest admitted pair has both reviews and at least
 * one holds. This checks that gate against what the real dispatcher records. C018's pair goes
 * through the real dispatcher, ledger, binding checks and managed SDK transport, over the
 * integration's own client, to a local destination that answers each review with a synthetic hold.
 * Nothing reaches the provider and nothing is spent. The answers are synthetic, so this is evidence
 * for the gate only, never for either case.
 */
test(
  "EDP-010 C060: the follow-up pair waits for C018's hold as the dispatcher records it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    const received: string[] = [];
    const answer = {
      verdict: "hold",
      findings: ["Synthetic controlled finding"],
      missingEvidence: [],
      observations: [],
      enhancedChecks: ["controlling_text", "amendments", "effective_dates", "exceptions", "jurisdiction"].map(
        (name) => ({ name, result: "fail", passage: "", note: "Synthetic controlled destination" }),
      ),
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
      { editorialCaseCandidate, prepareEditorialCaseManifest },
      { executeEditorialCaseReviews },
      { assertEditorialCasePrerequisite, editorialCaseOutcome, readEditorialCaseBatches },
      { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS },
    ] = await Promise.all([
      import("../ai/inference-budget-store"),
      import("../ai/inference-batch-dispatch"),
      import("../ai/inference-budget"),
      import("../ai/inference-allocation-package"),
      import("../ai/managed-inference"),
      import("../ai/managed-sdk-transport"),
      import("../ai-lanes"),
      import("./editorial-case-reviews"),
      import("./editorial-case-review-run"),
      import("./editorial-case-outcomes"),
      import("../../test-support/database-functions"),
    ]);
    const schema = `follow_up_${randomUUID().replaceAll("-", "")}`;
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
    try {
      const store = new InferenceBudgetStore(pool, schema, "additional-new");
      await store.mutate("isolated-fixture-reset", () => ({
        state: { ...emptyBudget(), priorUseReconciled: true },
        value: null,
      }));
      // A synthetic owner approval of an editorial-case package, in this isolated schema only.
      const pkg = await prepareFiniteAllocationPackage(new Date(), finitePackagePreparers.editorialCases),
        packageId = allocationPackageId(pkg),
        expires = new Date(Date.now() + 3600000).toISOString();
      await pool.query(
        `INSERT INTO "${schema}".valo_inference_batches
        (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
        VALUES($1,$2,$3,$4,true,'controlled-owner-fixture','controlled-package-approval',now(),$5)`,
        [packageId, requestDigest(inferenceProposal), requestDigest(pkg), JSON.stringify(pkg), expires],
      );
      // The runner's and the suite's read, from this isolated schema.
      const read = async (caseIds: string[]) => {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO "${schema}"`);
          return await readEditorialCaseBatches(client, caseIds);
        } finally {
          await client.query("RESET search_path");
          client.release();
        }
      };
      const prerequisite = async () =>
        assertEditorialCasePrerequisite("EVAL-EDP-C060", await read(["EVAL-EDP-C018"]));

      // 1. Before C018's pair is admitted, and once it is admitted but not yet reviewed, C060 waits.
      await assert.rejects(prerequisite, /EDITORIAL_CASE_PREREQUISITE_NOT_MET/, "nothing admitted");
      const c018 = prepareEditorialCaseManifest("EVAL-EDP-C018", { packageId });
      const held = await registerPreparedInferenceSubmanifest(store, c018, expires, assertFiniteWorkBindings);
      await assert.rejects(prerequisite, /EDITORIAL_CASE_PREREQUISITE_NOT_MET/, "admitted, not reviewed");

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
      const run = (batchId: string, works: typeof c018.works) =>
        withBoundInferenceDispatcher(dispatcher, () =>
          dispatcher.withPair(batchId, works[0]!.pair!, () => executeEditorialCaseReviews(works, put)),
        );

      // 2. C018's reviews hold, and the gate reads that hold from the results the dispatcher kept.
      const first = await run(held.batchId, c018.works);
      assert.deepEqual(
        first.map((r) => r.outcome),
        ["completed", "completed"],
      );
      assert.equal(received.length, 2);
      assert.deepEqual(await prerequisite(), { caseId: "EVAL-EDP-C018", batchId: held.batchId });
      const c018Outcome = editorialCaseOutcome("EVAL-EDP-C018", await read(["EVAL-EDP-C018"]));
      assert.ok(c018Outcome.status === "needs_evaluator_decision" && "reviews" in c018Outcome);
      assert.deepEqual(
        c018Outcome.reviews.map((r) => r.verdict),
        ["hold", "hold"],
      );

      // 3. C060's revised candidate then gets fresh reviews of its own, and its outcome names the
      // pair that held C018. Its records review its own candidate, never C018's.
      const c060 = prepareEditorialCaseManifest("EVAL-EDP-C060", { packageId });
      const follow = await registerPreparedInferenceSubmanifest(
        store,
        c060,
        expires,
        assertFiniteWorkBindings,
      );
      const second = await run(follow.batchId, c060.works);
      assert.deepEqual(
        second.map((r) => r.outcome),
        ["completed", "completed"],
      );
      assert.equal(received.length, 4);
      assert.ok(received.every((line) => line === "POST /v1/chat/completions"));
      const outcome = editorialCaseOutcome("EVAL-EDP-C060", await read(["EVAL-EDP-C060", "EVAL-EDP-C018"]));
      assert.ok(outcome.status === "needs_evaluator_decision" && "prerequisite" in outcome);
      assert.deepEqual(outcome.prerequisite, { caseId: "EVAL-EDP-C018", batchId: held.batchId });
      assert.equal(outcome.batchId, follow.batchId);
      const hashes = ["EVAL-EDP-C018", "EVAL-EDP-C060"].map(
        (id) => editorialCaseCandidate(id).candidate.hash,
      );
      assert.notEqual(hashes[0], hashes[1]);
      assert.deepEqual(
        kept.map((r) => [r.kind, r.caseId, r.candidateHash, r.formalCaseAccepted]),
        [
          ["editorial-case-review-v1", "EVAL-EDP-C018", hashes[0], false],
          ["editorial-case-review-v1", "EVAL-EDP-C018", hashes[0], false],
          ["editorial-case-review-v1", "EVAL-EDP-C060", hashes[1], false],
          ["editorial-case-review-v1", "EVAL-EDP-C060", hashes[1], false],
        ],
      );
    } finally {
      process.env.NODE_ENV = previousMode;
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
      await new Promise<void>((done) => destination.close(() => done()));
    }
  },
);
