import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * EDP-010, case C041 (decision 0015): a required review fails at the provider and a later retry does
 * not complete. The case asks for a real provider adapter and a controlled, actual failure, with no
 * invented response. So the review pair goes through the real dispatcher, ledger, binding checks,
 * managed SDK transport and the integration's own OpenAI client, configured, as in production, from
 * its environment, which here names a local destination that refuses every request. Nothing reaches
 * the provider and nothing is spent. This run's retained result is the case's controlled-failure
 * evidence; an independent reviewer still decides the case.
 */
test(
  "EDP-010 C041: a review that fails at the provider is kept as a failure, never retried into a review or past the batch's limits",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    let mode: "refuse" | "answer" = "refuse";
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
        if (mode === "refuse") {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Controlled outage", type: "server_error" } }));
          return;
        }
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
      { prepareEditorialCaseManifest },
      { executeEditorialCaseReviews },
      { editorialCaseOutcome },
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
    const schema = `controlled_${randomUUID().replaceAll("-", "")}`;
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
      const failing = prepareEditorialCaseManifest("EVAL-EDP-C041", { packageId });
      const unaffected = prepareEditorialCaseManifest("EVAL-EDP-C004", { packageId });
      const admitted = await registerPreparedInferenceSubmanifest(
        store,
        failing,
        expires,
        assertFiniteWorkBindings,
      );
      const other = await registerPreparedInferenceSubmanifest(
        store,
        unaffected,
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
      const run = (batchId: string, works: typeof failing.works) =>
        withBoundInferenceDispatcher(dispatcher, () =>
          dispatcher.withPair(batchId, works[0]!.pair!, () => executeEditorialCaseReviews(works, put)),
        );
      // The customer runtime test, which may run alongside this file, adds and removes its own
      // workspace's switch; those per-workspace rows are left out of the comparison.
      const switches = async () =>
        (
          await pool.query(
            "SELECT * FROM valo_safety_switches WHERE key NOT LIKE 'customer_ai_workspace:%' ORDER BY key",
          )
        ).rows as unknown[];
      const switchesBefore = await switches();
      const results = async (batchId: string) =>
        (await pool.query(`SELECT results FROM "${schema}".valo_inference_batches WHERE id=$1`, [batchId]))
          .rows[0]?.results ?? null;

      // 1. The destination refuses: each review is kept as the failure it was.
      const first = await run(admitted.batchId, failing.works);
      assert.ok(first.length === 2 && first.every((r) => r.outcome === "failed"));
      assert.ok(received.length >= 1, "a real request reached the controlled destination");
      assert.ok(received.every((line) => line === "POST /v1/chat/completions"));
      for (const record of kept) {
        assert.equal(record.kind, "editorial-case-review-failure-v1");
        assert.equal(record.caseId, "EVAL-EDP-C041");
        assert.equal("output" in record, false, "no answer is invented for a failed review");
        assert.equal(record.formalCaseAccepted, false);
      }
      assert.deepEqual((await results(admitted.batchId)) ?? {}, {}, "no provider result is recorded");
      const entries = (await store.mutate("inspect", (s) => ({ state: s, value: s }))).entries.filter((e) =>
        e.runKey.startsWith(`${admitted.batchId}:`),
      );
      assert.ok(entries.length >= 1 && entries.every((e) => e.status !== "settled"));

      // 2. The destination recovers, but running the same pair again sends nothing: the failed
      // attempt stays unresolved, and a further attempt needs a new work item and reservation.
      mode = "answer";
      const before = received.length;
      let again: Awaited<ReturnType<typeof run>> | null = null;
      try {
        again = await run(admitted.batchId, failing.works);
      } catch (error) {
        // The dispatcher may refuse the pair outright; either way nothing is sent.
        assert.match((error as Error).message, /^[A-Z_]{3,100}$/);
      }
      assert.equal(received.length, before, "no automatic retry reaches the destination");
      if (again) assert.ok(again.every((r) => r.outcome === "failed"));
      const batch = { id: admitted.batchId, manifest: failing, results: await results(admitted.batchId) };
      assert.deepEqual(
        { status: editorialCaseOutcome("EVAL-EDP-C041", [batch]).status },
        { status: "blocked" },
        "a failed or unretried review never counts as a review",
      );

      // 3. The unresolved attempts keep their concurrency slots until an operator reconciles them, so
      // other admitted work waits instead of exceeding the batch's limits: its pair is refused before
      // anything is sent, and recorded as refused, not answered. No safety switch is engaged, so
      // access outside this batch is untouched.
      const sent = received.length;
      const waiting = await run(other.batchId, unaffected.works);
      assert.deepEqual(
        waiting.map((r) => r.outcome),
        ["failed", "failed"],
      );
      assert.equal(received.length, sent, "nothing is sent past the batch's concurrency");
      assert.ok(kept.slice(-2).every((r) => r.code === "INFERENCE_CONCURRENCY_EXHAUSTED"));
      assert.deepEqual(await switches(), switchesBefore, "the outage engages no safety switch");
    } finally {
      process.env.NODE_ENV = previousMode;
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
      await new Promise<void>((done) => destination.close(() => done()));
    }
  },
);
