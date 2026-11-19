import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as database from "@workspace/db";
import { InferenceBudgetStore } from "../modules/ai/inference-budget-store";
import { FiniteInferenceDispatcher, type FiniteManifest } from "../modules/ai/inference-batch-dispatch";
import { inferenceProposal, requestDigest, emptyBudget } from "../modules/ai/inference-budget";
import { createManagedSDKTransport } from "../modules/ai/managed-sdk-transport";
import type { ArtifactRef } from "../modules/publication/publication-artifacts";
import type { ManagedRequest, ManagedCompletionResult } from "../modules/ai/managed-inference";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS } from "../test-support/database-functions";

test(
  "actual managed callers with real PostgreSQL, source/candidate/case checks and zero-network SDK",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 180000,
  },
  async (t) => {
    assertDevelopmentRuntime();
    const schema = `caller_${randomUUID().replaceAll("-", "")}`;
    const scoped = new Pool({ ...database.pool.options, max: 3, options: `-c search_path=${schema}` });
    scoped.on("connect", (client) => {
      const query = client.query.bind(client);
      // Some DSNs override startup options; establish scope before queued work.
      void query(`SET search_path TO "${schema}"`);
      client.query = ((...args: unknown[]) => {
        const statement = args[0],
          rewrite = (text: string) => text.replaceAll('"public".', `"${schema}".`);
        const scopedStatement =
          typeof statement === "string"
            ? rewrite(statement)
            : statement && typeof statement === "object" && "text" in statement
              ? { ...statement, text: rewrite(String(statement.text)) }
              : statement;
        return Reflect.apply(query, client, [scopedStatement, ...args.slice(1)]);
      }) as typeof client.query;
    });
    const directory = await mkdtemp(join(tmpdir(), "valo-real-callers-"));
    const snapshotPath = new URL(
      "../../../../docs/valo/evidence/chatgpt-provider-terms-snapshot.json",
      import.meta.url,
    );
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    const originalFetch = globalThis.fetch,
      oldNode = process.env.NODE_ENV,
      oldDeployment = process.env.REPLIT_DEPLOYMENT;
    let forbiddenNetwork = 0;
    globalThis.fetch = async () => {
      forbiddenNetwork++;
      throw Error("NETWORK_FORBIDDEN_IN_CONTROLLED_CALLER_TEST");
    };
    const createdRoles: string[] = [];
    const sharedFingerprint = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            "valo_content_versions",
            "valo_publication_policies",
            "valo_publication_audit",
            "valo_publication_ai_attempts",
            "valo_inference_budgets",
            "valo_inference_budget_events",
            "valo_inference_batches",
          ].map(async (table) => {
            const result = await database.pool.query(`SELECT encode(sha256(convert_to(
        coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS value FROM public."${table}" t`);
            return [table, result.rows[0].value];
          }),
        ),
      );
    let sharedBefore: Record<string, unknown> | undefined;
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(snapshot.retrievedAt) + 1000 });
    const fixtureClock = Date.now();
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const get = async (ref: ArtifactRef) => {
      assert.match(ref.id, /^[a-f0-9-]{36}$/);
      assert.ok(["json", "pdf", "docx"].includes(ref.extension));
      const bytes = await readFile(join(directory, `${ref.id}.${ref.extension}`));
      assert.equal(sha(bytes), ref.hash);
      return bytes;
    };
    const put = async (bytes: Buffer, extension: ArtifactRef["extension"]) => {
      const ref = { id: randomUUID(), hash: sha(bytes), extension };
      await writeFile(join(directory, `${ref.id}.${extension}`), bytes, { mode: 0o600, flag: "wx" });
      return ref;
    };
    try {
      sharedBefore = await sharedFingerprint();
      await database.pool.query(`CREATE SCHEMA "${schema}"`);
      assert.equal((await scoped.query("SELECT current_schema() AS name")).rows[0].name, schema);
      for (const role of ["valo_content_drafter_dev", "valo_content_publisher_dev"]) {
        if (!(await database.pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) {
          if (process.env.CI !== "true") throw Error("FIXTURE_ROLES_REQUIRE_EPHEMERAL_CI_DATABASE");
          await database.pool.query(`CREATE ROLE "${role}" NOLOGIN`);
          createdRoles.push(role);
        }
      }
      const tables = await database.pool.query(`SELECT tablename FROM pg_tables
      WHERE schemaname='public' AND left(tablename,5)='valo_'
      AND tablename NOT IN ('valo_inference_budgets','valo_inference_budget_events','valo_inference_batches')`);
      for (const { tablename: table } of tables.rows) {
        assert.match(table, /^valo_[a-z0-9_]+$/);
        await scoped.query(
          `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      // Customer AI limits read their totals across workspaces through this function; the copy
      // counts the fixture schema's drafts.
      await copyDatabaseFunctions(scoped, schema, [
        "valo_customer_ai_reservations(timestamptz,timestamptz,text)",
      ]);
      const serials = await scoped.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval(%'",
        [schema],
      );
      for (const [i, column] of serials.rows.entries()) {
        assert.match(column.table_name, /^valo_[a-z0-9_]+$/);
        assert.match(column.column_name, /^[a-z0-9_]+$/);
        await scoped.query(`CREATE SEQUENCE "${schema}".fixture_serial_${i}`);
        await scoped.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" SET DEFAULT nextval('"${schema}".fixture_serial_${i}')`,
        );
      }
      // The real preparer switches to its real least-privilege role. Without
      // fixture-schema usage PostgreSQL silently resolves an unqualified table
      // through public instead. Grants are confined to disposable fixture data.
      await scoped.query(`GRANT USAGE ON SCHEMA "${schema}" TO valo_content_drafter_dev`);
      await scoped.query(
        `GRANT SELECT,INSERT ON "${schema}".valo_content_versions TO valo_content_drafter_dev`,
      );
      await scoped.query(`GRANT USAGE ON SCHEMA "${schema}" TO valo_content_publisher_dev`);
      await scoped.query(
        `GRANT SELECT,UPDATE ON "${schema}".valo_content_versions TO valo_content_publisher_dev`,
      );
      await scoped.query(
        `GRANT SELECT,INSERT ON "${schema}".valo_publication_audit TO valo_content_publisher_dev`,
      );
      // LIKE does not retarget a serial's default. Never consume a genuine ledger sequence.
      await scoped.query(`CREATE SEQUENCE "${schema}".fixture_attempt_ids`);
      await scoped.query(
        `ALTER TABLE "${schema}".valo_publication_ai_attempts ALTER COLUMN id DROP IDENTITY IF EXISTS`,
      );
      await scoped.query(
        `ALTER TABLE "${schema}".valo_publication_ai_attempts ALTER COLUMN id SET DEFAULT nextval('"${schema}".fixture_attempt_ids')`,
      );
      const auditType = await scoped.query(
        "SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='valo_publication_audit' AND column_name='id'",
        [schema],
      );
      if (auditType.rows[0].data_type === "bigint") {
        await scoped.query(`CREATE SEQUENCE "${schema}".fixture_audit_ids`);
        await scoped.query(
          `ALTER TABLE "${schema}".valo_publication_audit ALTER COLUMN id DROP IDENTITY IF EXISTS`,
        );
        await scoped.query(
          `ALTER TABLE "${schema}".valo_publication_audit ALTER COLUMN id SET DEFAULT nextval('"${schema}".fixture_audit_ids')`,
        );
        await scoped.query(
          `GRANT USAGE ON SEQUENCE "${schema}".fixture_audit_ids TO valo_content_publisher_dev`,
        );
      }
      for (const file of ["0018_inference_budget.sql", "0020_inference_batch_authorization.sql"])
        await scoped.query(
          (await readFile(new URL(`../../../../lib/db/drizzle/${file}`, import.meta.url), "utf8")).replaceAll(
            "--> statement-breakpoint",
            "",
          ),
        );
      await copyDatabaseFunctions(scoped, schema, INFERENCE_LEDGER_FUNCTIONS);
      t.mock.module("@workspace/db", { namedExports: { ...database, db: drizzle(scoped), pool: scoped } });
      t.mock.module(new URL("../modules/publication/publication-artifacts.ts", import.meta.url).href, {
        namedExports: { getPublicationArtifact: get, putPublicationArtifact: put },
      });
      // Everything below is the real entry, real callers, real binding checker and real SQL store.
      // Only the model SDK and private file adapter are controlled; no checker is stubbed.
      const { assertFiniteWorkBindings } = await import("../modules/ai-lanes/inference-work-bindings");
      const { readOperationalInferenceReadiness } =
        await import("../modules/ai-lanes/inference-operational-ready");
      const { prepareOperationalCandidateRelease } =
        await import("../modules/editorial/operational-preparation");
      const { saveOperationalReviewPlan, executeOperationalReviewPlan } =
        await import("../modules/editorial/operational-review");
      const { prepareOperationalFiniteManifest } = await import("../modules/ai/inference-manifest");
      const { withBoundInferenceDispatcher, withApprovedInferencePair, withApprovedInferenceWork } =
        await import("../modules/ai/managed-inference");
      const { organizeCustomerDraft } = await import("../modules/ai-lanes/valo-customer-ai-model");
      const store = new InferenceBudgetStore(scoped, schema, "additional-new");
      const state = () => store.mutate("controlled-state-observation", (s) => ({ state: s, value: s }));
      const reset = () =>
        store.mutate("isolated-synthetic-fixture-reset", () => ({
          state: { ...emptyBudget(), priorUseReconciled: true },
          value: null,
        }));
      let calls = 0;
      let answer: (r: ManagedRequest) => Promise<ManagedCompletionResult>;
      const captured: ManagedRequest[] = [];
      const transport = createManagedSDKTransport(async () => ({
        chat: {
          completions: {
            create: async (request, options) => {
              assert.equal(options.maxRetries, 0);
              calls++;
              captured.push(structuredClone(request));
              return answer(request);
            },
          },
        },
      }));
      const dispatcher = new FiniteInferenceDispatcher(store, transport, assertFiniteWorkBindings);
      const run = <T>(fn: () => Promise<T>) => withBoundInferenceDispatcher(dispatcher, fn);
      const response = (
        content = JSON.stringify({
          verdict: "hold",
          findings: ["Controlled fixture; not a genuine review"],
          missingEvidence: [],
          observations: [],
        }),
      ): ManagedCompletionResult => ({
        id: `controlled-no-network-${randomUUID()}`,
        model: "gpt-5.4-mini-2026-03-17",
        created: Math.floor(Date.now() / 1000),
        choices: [{ finish_reason: "stop", message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      });
      const seed = async (manifest: FiniteManifest) => {
        const id = `isolated-control-${randomUUID()}`;
        await scoped.query(
          `INSERT INTO "${schema}".valo_inference_batches
        (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
        VALUES($1,$2,$3,$4,true,'CONTROLLED FIXTURE NOT OWNER APPROVAL','ISOLATED SCHEMA ONLY',$5,$6)`,
          [
            id,
            requestDigest(inferenceProposal),
            requestDigest(manifest),
            JSON.stringify(manifest),
            new Date(),
            new Date(Date.now() + 3600000),
          ],
        );
        return id;
      };
      const operational = async () => {
        const saved = await prepareOperationalCandidateRelease("TPL-07", snapshotPath.pathname);
        const current = await readOperationalInferenceReadiness(saved.id);
        const plan = await saveOperationalReviewPlan(
          current.candidate,
          current.rightsInput,
          current.provenanceInput,
          current.exportReport,
          current.serverEvidence,
        );
        const manifest = prepareOperationalFiniteManifest({
          candidateVersionId: saved.id,
          candidateHash: current.candidate.hash,
          bundleHash: requestDigest(current.bundle),
          sourceHashes: current.bundle.sources.map((s) => s.hash),
          sourceFiles: [
            { path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash },
          ],
          plan,
        });
        const id = await seed(manifest),
          pair = manifest.works[0]!.pair!;
        return {
          current,
          plan,
          manifest,
          id,
          pair,
          execute: () =>
            run(() =>
              withApprovedInferencePair(id, pair, () =>
                executeOperationalReviewPlan(plan, current.candidate, current.serverEvidence),
              ),
            ),
        };
      };
      await reset();
      await t.test(
        "actual two-role caller binds each distinct request and settles the atomic reserved pair",
        async () => {
          const fixture = await operational(),
            before = calls;
          answer = async () => response();
          const reviews = await fixture.execute();
          assert.equal(reviews.length, 2);
          assert.equal(calls - before, 2);
          assert.notEqual(requestDigest(captured.at(-1)), requestDigest(captured.at(-2)));
          assert.deepEqual(
            reviews.map((r) => r.record.role),
            ["factual", "challenge"],
          );
          assert.ok(reviews.every((r) => r.record.outboundAttempted));
          const entries = (await state()).entries;
          assert.equal(entries.length, 2);
          assert.ok(entries.every((e) => e.status === "settled"));
          assert.deepEqual(
            new Set(entries.map((e) => e.requestHash)),
            new Set(fixture.manifest.works.map((w) => requestDigest(w.request))),
          );
        },
      );
      for (const failure of ["bound-breach", "suspended", "unreconciled", "unbounded"] as const) {
        await t.test(`actual first-role ${failure} stops already reserved challenge before SDK`, async () => {
          await reset();
          const fixture = await operational(),
            before = calls;
          answer = async () => {
            const entries = (await state()).entries;
            assert.equal(entries.length, 2, "both roles reserved before first transport");
            assert.equal(entries.filter((e) => e.status === "reserved").length, 1);
            if (failure === "bound-breach")
              return {
                ...response(),
                usage: { prompt_tokens: 400001, completion_tokens: 10, total_tokens: 400011 },
              };
            await store.mutate("controlled-concurrent-financial-hold", (s) => ({
              state: {
                ...s,
                ...(failure === "suspended"
                  ? { suspended: true }
                  : failure === "unreconciled"
                    ? { priorUseReconciled: false }
                    : { unboundedPrior: ["controlled-unreconciled-liability"] }),
              },
              value: null,
            }));
            return response();
          };
          const reviews = await fixture.execute();
          assert.equal(calls - before, 1);
          assert.ok(!reviews.some((r) => r.record.role === "challenge"));
          const ledger = await state(),
            challenge = ledger.entries.find((e) => e.runKey.endsWith(fixture.manifest.works[1]!.key))!;
          assert.equal(challenge.status, "reserved");
          assert.equal(challenge.responseId, undefined);
          const attempts = await scoped.query(
            `SELECT role,outcome,error_code FROM valo_publication_ai_attempts WHERE candidate_hash=$1`,
            [fixture.current.candidate.hash],
          );
          assert.equal(
            attempts.rows.find((r) => r.role === "challenge").error_code,
            "PRIOR_CHARGES_UNRECONCILED",
          );
        });
      }
      await t.test("a single-work wrapper cannot run the whole review or create attempt rows", async () => {
        await reset();
        const fixture = await operational(),
          before = calls;
        await assert.rejects(
          () =>
            run(() =>
              withApprovedInferenceWork(fixture.id, fixture.manifest.works[0]!.key, () =>
                executeOperationalReviewPlan(
                  fixture.plan,
                  fixture.current.candidate,
                  fixture.current.serverEvidence,
                ),
              ),
            ),
          /APPROVED_REVIEW_PAIR_REQUIRED/,
        );
        assert.equal(calls, before);
        assert.equal((await state()).entries.length, 0);
        assert.equal(
          (
            await scoped.query(
              "SELECT count(*)::int AS n FROM valo_publication_ai_attempts WHERE candidate_hash=$1",
              [fixture.current.candidate.hash],
            )
          ).rows[0].n,
          0,
        );
      });
      await t.test(
        "real candidate and source corruption stop the actual review entry without transport",
        async () => {
          await reset();
          const fixture = await operational(),
            before = calls;
          await scoped.query("UPDATE valo_content_versions SET candidate_hash=$1 WHERE id=$2", [
            "e".repeat(64),
            fixture.current.row.id,
          ]);
          await assert.rejects(fixture.execute, /CANDIDATE_BINDING_CHANGED/);
          await scoped.query("UPDATE valo_content_versions SET candidate_hash=$1 WHERE id=$2", [
            fixture.current.candidate.hash,
            fixture.current.row.id,
          ]);
          const modified = structuredClone(fixture.manifest);
          for (const work of modified.works) work.bindings.sourceFiles[0]!.sha256 = "e".repeat(64);
          const id = await seed(modified);
          await assert.rejects(
            () => run(() => withApprovedInferencePair(id, fixture.pair, async () => null)),
            /SOURCE_BINDING_CHANGED/,
          );
          assert.equal(calls, before);
          assert.equal((await state()).entries.length, 0);
        },
      );
      const { prepareCustomerFiniteManifest, executeApprovedCustomerManifest } =
        await import("../modules/ai-lanes/inference-customer-manifest");
      const { input } = await prepareCustomerFiniteManifest("CAI-CAND-INV-01");
      const customer = async (retry: boolean, wrongCase = false) => {
        const { manifest } = await prepareCustomerFiniteManifest("CAI-CAND-INV-01", {
          retry,
          now: new Date(),
        });
        if (wrongCase) {
          manifest.works[0]!.caseHash = "e".repeat(64);
          manifest.works[0]!.candidateHash = "e".repeat(64);
        }
        return { id: await seed(manifest), key: manifest.works[0]!.key, manifest };
      };
      for (const retry of [false, true])
        await t.test(
          `actual customer caller ${retry ? "uses explicit reserved retry" : "refuses an unreserved retry"}`,
          async () => {
            await reset();
            const fixture = await customer(retry),
              before = calls;
            let attempt = 0;
            answer = async () =>
              response(++attempt === 1 ? "{}" : JSON.stringify({ opening: "none", sections: [] }));
            const result = await run(() =>
              withApprovedInferenceWork(fixture.id, fixture.key, () => organizeCustomerDraft(input)),
            );
            assert.equal(calls - before, retry ? 2 : 1);
            assert.equal(result.failureCode, retry ? null : "AI_MANAGED_BUDGET_HELD");
            assert.equal((await state()).entries.length, retry ? 2 : 1);
          },
        );
      await t.test(
        "the actual customer corpus binding rejects a changed case with zero SDK calls",
        async () => {
          await reset();
          const fixture = await customer(false, true),
            before = calls;
          await assert.rejects(
            () =>
              run(() =>
                withApprovedInferenceWork(fixture.id, fixture.key, () => organizeCustomerDraft(input)),
              ),
            /CASE_BINDING_CHANGED/,
          );
          assert.equal(calls, before);
          assert.equal((await state()).entries.length, 0);
        },
      );
      const { resolveWorkspace } = await import("./valo-store");
      await t.test(
        "the default runner cannot create or substitute a missing evaluation identity",
        async () => {
          await reset();
          const fixture = await customer(false),
            before = calls;
          await assert.rejects(
            () => run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest)),
            /EXISTING_AUTHORIZED_CUSTOMER_EVALUATION_WORKSPACE_REQUIRED/,
          );
          assert.equal(calls, before);
          assert.equal((await state()).entries.length, 0);
        },
      );
      const runnerActor = await resolveWorkspace(`valo-ai-eval-invoice-controlled-${randomUUID()}`);
      const { createCustomerAIDraft } = await import("../modules/ai-lanes/valo-customer-ai");
      await createCustomerAIDraft(runnerActor, { ...input, idempotencyKey: randomUUID() });
      await t.test(
        "actual approved customer runner selects its distinct retry and rejects a revoked batch",
        async () => {
          await reset();
          const fixture = await customer(true),
            before = calls;
          let attempt = 0;
          answer = async () =>
            response(++attempt === 1 ? "{}" : JSON.stringify({ opening: "none", sections: [] }));
          const result = await run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest));
          assert.equal(result.result.status, "ready");
          assert.equal(calls - before, 2);
          assert.equal(result.providerQualityAccepted, false);
          await scoped.query("UPDATE valo_inference_batches SET enabled=false WHERE id=$1", [fixture.id]);
          await assert.rejects(
            () => run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest)),
            /NOT_AUTHORIZED/,
          );
          assert.equal(calls - before, 2);
        },
      );
      for (const mode of ["wrong-model", "bad-usage", "expired", "revoked"] as const)
        await t.test(`actual customer runner ${mode} retains exposure without another dispatch`, async () => {
          await reset();
          const fixture = await customer(true),
            before = calls;
          answer = async () => {
            const value = response(
              mode === "expired" || mode === "revoked"
                ? "{}"
                : JSON.stringify({ opening: "none", sections: [] }),
            );
            if (mode === "wrong-model") value.model = "gpt-5.4-mini-unknown-snapshot";
            if (mode === "bad-usage")
              value.usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 99 };
            if (mode === "expired") t.mock.timers.setTime(fixtureClock + 2 * 3600000);
            if (mode === "revoked")
              await scoped.query("UPDATE valo_inference_batches SET enabled=false WHERE id=$1", [fixture.id]);
            return value;
          };
          try {
            const result = await run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest));
            assert.equal(calls - before, 1);
            const ledger = await state();
            if (mode === "wrong-model" || mode === "bad-usage") {
              assert.equal(result.result.status, "manual_fallback");
              assert.equal(ledger.entries[0]!.status, "unknown");
              assert.equal(ledger.suspended, true);
              assert.ok(BigInt(ledger.entries[0]!.reserved) > 0n);
            } else {
              assert.equal(ledger.entries[0]!.status, "settled");
              assert.ok(ledger.entries[0]!.responseId);
              assert.equal(result.result.status, "manual_fallback");
              assert.equal(result.result.providerCalls, 1);
              await assert.rejects(
                () => run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest)),
                /EXPIRED|NOT_AUTHORIZED/,
              );
              assert.equal(calls - before, 1);
            }
          } finally {
            t.mock.timers.setTime(fixtureClock);
          }
        });
      await t.test(
        "real persisted customer service keeps default hold but admits an approved finite context",
        async () => {
          const { resolveWorkspace } = await import("./valo-store");
          const { createCustomerAIDraft } = await import("../modules/ai-lanes/valo-customer-ai");
          const actor = await resolveWorkspace(`controlled-finite-customer-${randomUUID()}`);
          await reset();
          const before = calls;
          const held = await createCustomerAIDraft(actor, { ...input, idempotencyKey: randomUUID() });
          assert.equal(held.status, "manual_fallback");
          assert.equal(calls, before);
          const fixture = await customer(false);
          answer = async () => response(JSON.stringify({ opening: "none", sections: [] }));
          const ready = await run(() =>
            withApprovedInferenceWork(fixture.id, fixture.key, () =>
              createCustomerAIDraft(actor, { ...input, idempotencyKey: randomUUID() }),
            ),
          );
          assert.equal(ready.status, "ready");
          assert.equal(calls - before, 1);
          assert.equal(inferenceProposal.enabled, false);
          const after = await createCustomerAIDraft(actor, { ...input, idempotencyKey: randomUUID() });
          assert.equal(after.status, "manual_fallback");
          assert.equal(calls - before, 1);
        },
      );
      await t.test(
        "finite customer runner does not bypass the existing per-identity minute limit",
        async () => {
          await reset();
          const fixture = await customer(false),
            before = calls;
          const held = await run(() => executeApprovedCustomerManifest(fixture.id, fixture.manifest));
          assert.equal(held.result.status, "manual_fallback");
          assert.equal(calls, before);
          assert.equal((await state()).entries.length, 0);
        },
      );
      assert.equal(forbiddenNetwork, 0);
      assert.equal(inferenceProposal.enabled, false);
    } finally {
      globalThis.fetch = originalFetch;
      t.mock.timers.reset();
      if (oldNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNode;
      if (oldDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
      else process.env.REPLIT_DEPLOYMENT = oldDeployment;
      await scoped.end();
      await database.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      for (const role of createdRoles) await database.pool.query(`DROP ROLE "${role}"`);
      await rm(directory, { recursive: true, force: true });
      if (sharedBefore)
        assert.deepEqual(
          await sharedFingerprint(),
          sharedBefore,
          "no shared content, real usage or approval rows may change",
        );
    }
  },
);
