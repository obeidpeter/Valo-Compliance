import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as database from "@workspace/db";
import { InferenceBudgetStore } from "../modules/ai/inference-budget-store";
import type { FiniteManifest } from "../modules/ai/inference-batch-dispatch";
import { inferenceProposal, requestDigest, emptyBudget } from "../modules/ai/inference-budget";
import { createManagedSDKTransport } from "../modules/ai/managed-sdk-transport";
import type { ArtifactRef } from "../modules/publication/publication-artifacts";
import type { ManagedRequest, ManagedCompletionResult } from "../modules/ai/managed-inference";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS } from "../test-support/database-functions";
import { digest } from "@workspace/valo-core";

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
    const snapshotPath = fileURLToPath(
      new URL("../../../../docs/valo/evidence/chatgpt-provider-terms-snapshot.json", import.meta.url),
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
      // As the private store does, a file whose bytes no longer match its reference is refused.
      if (sha(bytes) !== ref.hash) throw Error("PUBLICATION_ASSET_HASH_MISMATCH");
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
      await scoped.query(
        `GRANT SELECT,INSERT ON "${schema}".valo_prepared_candidates TO valo_content_drafter_dev`,
      );
      await scoped.query(`GRANT USAGE ON SCHEMA "${schema}" TO valo_content_publisher_dev`);
      await scoped.query(
        `GRANT SELECT,UPDATE ON "${schema}".valo_content_versions TO valo_content_publisher_dev`,
      );
      await scoped.query(
        `GRANT SELECT,INSERT ON "${schema}".valo_publication_audit TO valo_content_publisher_dev`,
      );
      // The publisher's remaining reads and writes, as migrations 0007 and 0009 grant them, so the
      // publish command's success path runs the real publisher in this disposable schema only.
      await scoped.query(
        `GRANT SELECT ON "${schema}".valo_publication_policies TO valo_content_publisher_dev,valo_content_drafter_dev`,
      );
      await scoped.query(
        `GRANT SELECT ON "${schema}".valo_source_watches,"${schema}".valo_source_snapshots,"${schema}".valo_source_release_bindings,"${schema}".valo_source_impacts,"${schema}".valo_source_review_work TO valo_content_publisher_dev`,
      );
      await scoped.query(
        `GRANT INSERT ON "${schema}".valo_source_release_bindings TO valo_content_publisher_dev`,
      );
      await scoped.query(
        `GRANT UPDATE(status,replacement_kind,replacement_id,completed_at) ON "${schema}".valo_source_review_work TO valo_content_publisher_dev`,
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
      // The fixture schema's copied tables carry no triggers, and the application is pointed at
      // them through this one pool: the release runs on it too, not on the real publisher login.
      t.mock.module("@workspace/db", {
        namedExports: { ...database, db: drizzle(scoped), pool: scoped, publisherDb: () => drizzle(scoped) },
      });
      t.mock.module(new URL("../modules/publication/publication-artifacts.ts", import.meta.url).href, {
        namedExports: { getPublicationArtifact: get, putPublicationArtifact: put },
      });
      // A guide answers to the guidance policy, which the owner approved on 22 November 2026: the
      // recorded approval is of the policy file as it stands. The guide subtest at the end supposes
      // that approval absent for a moment, under a version of its own; everywhere else the policy is
      // as it really stands.
      const realGuidancePolicy = await import("../modules/publication/guidance-policy");
      const { publicationWorkspaceRoot } = await import("../modules/publication/operational-policy");
      assert.equal(
        realGuidancePolicy.guidancePolicyApprovedHash(),
        sha(await readFile(join(publicationWorkspaceRoot(), realGuidancePolicy.GUIDANCE_POLICY_PATH))),
        "the recorded approval is of the policy file as it stands",
      );
      const guideApproval = { absent: false };
      const guidancePolicyWithoutApproval = async (
        options: Parameters<typeof realGuidancePolicy.guidancePolicy>[0] = {},
      ) => {
        const base = await realGuidancePolicy.guidancePolicy({ ...options, approvedHash: null });
        const { hash: _approvedVersionHash, ...body } = base.policy;
        const supposed = { ...body, version: `${body.version}/approval-absent-in-a-test` };
        return { policy: { ...supposed, hash: digest(supposed) }, authority: base.authority };
      };
      t.mock.module(new URL("../modules/publication/guidance-policy.ts", import.meta.url).href, {
        namedExports: {
          ...realGuidancePolicy,
          guidancePolicy: (options?: Parameters<typeof realGuidancePolicy.guidancePolicy>[0]) =>
            guideApproval.absent
              ? guidancePolicyWithoutApproval(options)
              : realGuidancePolicy.guidancePolicy(options),
        },
      });
      // A capture's text is read from memory, where a real capture's is read from private storage.
      const captureTexts = new Map<string, string>();
      const realSourceStorage = await import("../modules/sources/source-storage");
      t.mock.module(new URL("../modules/sources/source-storage.ts", import.meta.url).href, {
        namedExports: {
          ...realSourceStorage,
          readSourceText: async (snapshotId: string, checksum: string) => {
            const text = captureTexts.get(snapshotId);
            if (text === undefined || sha(Buffer.from(text)) !== checksum)
              throw Error("SOURCE_STORAGE_CHECKSUM_FAILED");
            return text;
          },
        },
      });
      // Everything below is the real entry, real callers, real binding checker and real SQL store.
      // Only the model SDK and private file adapter are controlled; no checker is stubbed.
      // The dispatcher loads the publication index, so it too loads only after the stand-ins.
      const { FiniteInferenceDispatcher } = await import("../modules/ai/inference-batch-dispatch");
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
        // A prepared candidate is not saved until its reviews pass (decision 0014), so each
        // fixture takes the same version number; preparing each at its own moment keeps every
        // fixture a distinct candidate with its own attempts.
        t.mock.timers.tick(1000);
        const saved = await prepareOperationalCandidateRelease("TPL-07", snapshotPath);
        assert.ok(saved.candidateArtifact, "a prepared candidate awaits its reviews as an artifact");
        const current = await readOperationalInferenceReadiness({
          candidateVersionId: saved.id,
          candidateArtifact: saved.candidateArtifact,
        });
        const plan = await saveOperationalReviewPlan(
          current.candidate,
          current.rightsInput,
          current.provenanceInput,
          current.exportReport,
          current.serverEvidence,
        );
        const manifest = prepareOperationalFiniteManifest({
          candidateVersionId: saved.id,
          candidateArtifact: saved.candidateArtifact,
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
          // The candidate under review is a private artifact (decision 0014): a change to its file
          // is refused, and so is a version saved under its ID while its reviews are pending.
          const candidateFile = join(
            directory,
            `${fixture.manifest.works[0]!.bindings.candidateArtifact!.id}.json`,
          );
          const candidateBytes = await readFile(candidateFile);
          const altered = JSON.parse(candidateBytes.toString());
          altered.slug = "altered-slug";
          await writeFile(candidateFile, JSON.stringify(altered));
          await assert.rejects(fixture.execute, /PUBLICATION_ASSET_HASH_MISMATCH/);
          await writeFile(candidateFile, candidateBytes);
          const row = fixture.current.row;
          await scoped.query(
            `INSERT INTO valo_content_versions
            (id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              row.id,
              row.templateId,
              row.version,
              row.slug,
              row.policyId,
              row.candidateHash,
              JSON.stringify(row.bundle),
              JSON.stringify(row.attestations),
              row.reviewBy,
            ],
          );
          await assert.rejects(fixture.execute, /CANDIDATE_ALREADY_SAVED/);
          await scoped.query("DELETE FROM valo_content_versions WHERE id=$1", [row.id]);
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
      // Decision 0014's publish command, on reviews the real caller ran in this disposable schema
      // through the zero-network SDK. Each review is a controlled fixture, never a genuine review.
      const { publishReviewedOperationalCandidate } =
        await import("../modules/ai-lanes/inference-reviewed-publication");
      const passing = () =>
        response(
          JSON.stringify({
            verdict: "pass",
            findings: [],
            missingEvidence: [],
            observations: ["Controlled fixture; not a genuine review"],
          }),
        );
      const publish = (batchId: string, reviews: ArtifactRef[]) =>
        publishReviewedOperationalCandidate({ batchId, reviews });
      const savedVersion = async (id: string) =>
        (
          await scoped.query(
            "SELECT status,version,bundle,attestations FROM valo_content_versions WHERE id=$1",
            [id],
          )
        ).rows[0];
      const versionOf = (fixture: Awaited<ReturnType<typeof operational>>) =>
        fixture.manifest.works[0]!.bindings.candidateVersionId!;
      const copy = (record: object) => put(Buffer.from(JSON.stringify(record)), "json");
      await t.test(
        "the publish command accepts only the reviews its approved batch settled for the candidate",
        async () => {
          await reset();
          answer = async () => passing();
          const a = await operational(),
            b = await operational();
          const reviews = await a.execute(),
            others = await b.execute();
          assert.equal(reviews.length, 2);
          assert.equal(others.length, 2);
          const before = calls,
            [factual, challenge] = reviews as [(typeof reviews)[0], (typeof reviews)[0]];
          await assert.rejects(
            () =>
              publish(
                a.id,
                others.map((r) => r.artifact),
              ),
            /REVIEW_NOT_SETTLED_BY_APPROVED_BATCH/,
          );
          await assert.rejects(
            async () =>
              publish(a.id, [
                await copy({
                  ...factual.record,
                  providerResponseId: `controlled-no-network-${randomUUID()}`,
                }),
                challenge.artifact,
              ]),
            /REVIEW_NOT_SETTLED_BY_APPROVED_BATCH/,
          );
          await assert.rejects(
            async () =>
              publish(a.id, [
                await copy({
                  ...factual.record,
                  serverEvidence: { ...factual.record.serverEvidence, sourceHash: "e".repeat(64) },
                }),
                challenge.artifact,
              ]),
            /REVIEW_BINDING_CHANGED/,
          );
          await assert.rejects(
            async () =>
              publish(a.id, [
                await copy({ ...factual.record, reviewPlanHash: "e".repeat(64) }),
                challenge.artifact,
              ]),
            /REVIEW_BINDING_CHANGED/,
          );
          await assert.rejects(() => publish(a.id, [factual.artifact]), /REVIEWED_PAIR_ARGUMENTS_INVALID/);
          await assert.rejects(
            () => publish(a.id, [factual.artifact, factual.artifact]),
            /REVIEWS_NOT_INDEPENDENT/,
          );
          await assert.rejects(
            () => publish(`isolated-control-${randomUUID()}`, [factual.artifact, challenge.artifact]),
            /INFERENCE_MANIFEST_INVALID/,
          );
          // A review counts only once the ledger settled its work.
          await store.mutate("controlled-unsettled-entry", (s) => ({
            state: {
              ...s,
              entries: s.entries.map((e) =>
                e.runKey === `${a.id}:${a.manifest.works[0]!.key}` ? { ...e, status: "unknown" as const } : e,
              ),
            },
            value: null,
          }));
          await assert.rejects(
            () => publish(a.id, [factual.artifact, challenge.artifact]),
            /REVIEW_NOT_SETTLED_BY_APPROVED_BATCH/,
          );
          // A candidate past its review date is not published.
          const now = Date.now();
          t.mock.timers.setTime(Date.parse(b.current.candidate.reviewBy!) + 1000);
          try {
            await assert.rejects(
              () =>
                publish(
                  b.id,
                  others.map((r) => r.artifact),
                ),
              /CANDIDATE_UNAVAILABLE_OR_STALE/,
            );
          } finally {
            t.mock.timers.setTime(now);
          }
          assert.equal(calls, before);
          for (const fixture of [a, b]) assert.equal(await savedVersion(versionOf(fixture)), undefined);
        },
      );
      await t.test(
        "a reviewed pair that fails a gate is saved with its reviews and held, and held stays final",
        async () => {
          await reset();
          answer = async () => response();
          const fixture = await operational(),
            sameNumber = await operational();
          const reviews = await fixture.execute(),
            others = await sameNumber.execute(),
            before = calls,
            id = versionOf(fixture);
          const result = await publish(
            fixture.id,
            reviews.map((r) => r.artifact),
          );
          assert.equal(result.eligibility?.decision, "hold");
          assert.equal(result.status, "held");
          const row = await savedVersion(id);
          assert.equal(row.status, "held");
          assert.equal(row.version, fixture.current.row.version);
          assert.deepEqual(
            row.bundle.reviews.map((r: { role: string; verdict: string }) => [r.role, r.verdict]),
            [
              ["factual", "hold"],
              ["challenge", "hold"],
            ],
          );
          assert.deepEqual(
            row.attestations.reviews,
            reviews.map((r) => r.artifact),
          );
          const again = await publish(
            fixture.id,
            reviews.map((r) => r.artifact),
          );
          assert.equal(again.decision, "held");
          assert.equal(again.rerun, true);
          assert.equal((await savedVersion(id)).status, "held");
          // Another candidate prepared under the same version number can no longer be published.
          await assert.rejects(
            () =>
              publish(
                sameNumber.id,
                others.map((r) => r.artifact),
              ),
            /CANDIDATE_ALREADY_SAVED/,
          );
          assert.equal(calls, before);
          // A run that stopped after saving a candidate, before its outcome: the rerun records the
          // hold the saved bundle fails on, as the first run would have.
          const stopped = await operational(),
            stoppedReviews = await stopped.execute(),
            stoppedRow = stopped.current.row;
          await scoped.query(
            `INSERT INTO valo_content_versions
            (id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              stoppedRow.id,
              stoppedRow.templateId,
              stoppedRow.version,
              stoppedRow.slug,
              stoppedRow.policyId,
              stoppedRow.candidateHash,
              JSON.stringify(stoppedRow.bundle),
              JSON.stringify(stoppedRow.attestations),
              stoppedRow.reviewBy,
            ],
          );
          const resumed = await publish(
            stopped.id,
            stoppedReviews.map((r) => r.artifact),
          );
          assert.equal(resumed.decision, "held");
          assert.equal(resumed.rerun, true);
          assert.equal((await savedVersion(stoppedRow.id)).status, "held");
        },
      );
      await t.test(
        "two passing synthetic reviews publish the saved version through the real publisher, in this disposable schema",
        async () => {
          await reset();
          answer = async () => passing();
          const fixture = await operational();
          const reviews = await fixture.execute(),
            before = calls,
            id = versionOf(fixture);
          assert.equal(reviews.length, 2);
          assert.equal(await savedVersion(id), undefined, "nothing is saved before the reviews are checked");
          const result = await publish(
            fixture.id,
            reviews.map((r) => r.artifact),
          );
          assert.equal(result.eligibility?.decision, "eligible");
          assert.equal(result.status, "published");
          const row = await savedVersion(id);
          assert.equal(row.status, "published");
          assert.equal(row.bundle.manifest.status, "eligible");
          assert.deepEqual(row.bundle.enhancedChecks, []);
          assert.deepEqual(
            row.bundle.reviews.map((r: { runId: string }) => r.runId),
            reviews.map((r) => r.record.providerResponseId),
          );
          assert.deepEqual(
            (
              await scoped.query("SELECT action FROM valo_publication_audit WHERE version_id=$1", [id])
            ).rows.map((r) => r.action),
            ["published"],
          );
          const again = await publish(
            fixture.id,
            reviews.map((r) => r.artifact),
          );
          assert.equal(again.decision, "published");
          assert.equal(again.rerun, true);
          assert.equal(calls, before);
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
      const { resolveWorkspace } = await import("../modules/workspaces");
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
          const { resolveWorkspace } = await import("../modules/workspaces");
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
      // Decision 0017: a guide is prepared on the same route, under the policy the owner approved, from
      // captures made of the passages kept in the repository. Its pair of reviews is not sent: the
      // publisher releases a guide only after the owner's source check (decision 0018), which this
      // route does not have, so no package of guide reviews is approved or admitted (CMP-008,
      // EDP-004). The approvals tried are synthetic ones in this schema.
      await t.test(
        "a guide's review pair is prepared and planned, and refused before any approval, admission or model call",
        async () => {
          await reset();
          const { prepareGuideCandidateRelease } = await import("../modules/editorial/guidance-preparation");
          const { retainedGuidePassages } = await import("../modules/publication/guidance-passages");
          const { guideActLeads } = await import("../modules/publication/guidance-captures");
          const { guideAmendmentRecords } = await import("../modules/publication/guidance-amendments");
          const { guideClaimMaps } = await import("../modules/publication/guidance-bundle");
          const { buildGuideClaims } = await import("../modules/publication/guidance-claim-map");
          const { readGuidanceIntake } = await import("../modules/publication/operational-intake");
          const { controlledTermsSnapshot } =
            await import("../modules/publication/guidance-release.fixtures");
          const { liveReleasedVersions, releasedResources } =
            await import("../modules/catalogue/valo-released-content");
          const guide = "GUD-02",
            clockBefore = Date.now();
          // This subtest runs on the real clock, where the others run on a fixed one. The database
          // stamps an approval, an admission and a review attempt with the real time, and the
          // dispatcher compares each stamp with the application's clock: under a fixed clock a
          // pair admitted under an approval could never be sent. The amendment records a guide's
          // sources rest on were made on 21 November 2026, after the fixed clock.
          t.mock.timers.reset();
          assert.ok(Date.now() > clockBefore, "the real clock is later than the test's fixed one");
          try {
            const now = new Date(),
              checkedAt = new Date(+now - 3_600_000);
            // The capture the daily check would hold of the one Act this guide quotes: the passages
            // kept in the repository, under the checksum the Act's amendment record describes.
            const retained = retainedGuidePassages();
            const intake = await readGuidanceIntake(guide);
            const needed = buildGuideClaims(
              guideClaimMaps.find((m) => m.id === guide)!,
              intake.section.body,
              retained,
            ).sources.map((source) => retained(source.id)!);
            assert.ok(needed.length > 0 && needed.every((p) => p.instrument.id === "CAC-CAMA-2020"));
            const leadId = guideActLeads["CAC-CAMA-2020"]!,
              url = needed[0]!.instrument.url,
              snapshotId = randomUUID(),
              text = needed.map((p) => p.text).join("\n\f\n"),
              rawChecksum = guideAmendmentRecords.find((r) => r.instrument === "CAC-CAMA-2020")!.rawSha256;
            captureTexts.set(snapshotId, text);
            await scoped.query(
              `INSERT INTO valo_source_snapshots(id,source_id,url,final_url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,extraction_version,metadata)
               VALUES($1,$2,$3,$3,$4,$4,'retrieved_unreviewed',200,'application/pdf',$5,$6,'synthetic-in-memory','synthetic-in-memory','synthetic','{"synthetic":true}')`,
              [snapshotId, leadId, url, checkedAt, rawChecksum, sha(Buffer.from(text))],
            );
            await scoped.query(
              `INSERT INTO valo_source_watches(source_id,url,risk,last_snapshot_id,last_raw_hash,checked_at,failure_code)
               VALUES($1,$2,'high',$3,$4,$5,null)`,
              [leadId, url, snapshotId, rawChecksum, checkedAt],
            );
            const termsPath = join(directory, "guide-terms.json");
            // Controlled pages holding the passages the provider-permission record looks for.
            await writeFile(termsPath, JSON.stringify(controlledTermsSnapshot(checkedAt)));

            // Prepared from the stored capture, as the operator's command prepares it.
            const prepared = await prepareGuideCandidateRelease(guide, termsPath);
            assert.equal(prepared.state, "awaiting_reviews", prepared.reasons.join(", "));
            assert.ok(prepared.candidateArtifact && prepared.id);
            const current = await readOperationalInferenceReadiness({
              candidateVersionId: prepared.id,
              candidateArtifact: prepared.candidateArtifact,
            });
            const plan = await saveOperationalReviewPlan(
              current.candidate,
              current.rightsInput,
              current.provenanceInput,
              current.exportReport,
              current.serverEvidence,
              undefined,
              current.bundle.sources,
            );
            assert.equal(plan.manifest.status, "mechanically_planned_not_reserved");
            const manifest = prepareOperationalFiniteManifest({
              candidateVersionId: prepared.id,
              candidateArtifact: prepared.candidateArtifact,
              candidateHash: current.candidate.hash,
              bundleHash: requestDigest(current.bundle),
              sourceHashes: current.bundle.sources.map((source) => source.hash),
              sourceFiles: [
                { path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash },
              ],
              plan,
            });

            // The pair is admitted under an approval, as the operator's admit command admits it.
            // The approvals are made up: synthetic packages, approved in this disposable schema
            // with the approval command's own function. Admission makes the dispatcher's checks on
            // both requests again and calls no model.
            const {
              allocationPackageId,
              approveFiniteAllocationPackage,
              finitePackagePreparers,
              prepareFiniteAllocationPackage,
              registerPreparedInferenceSubmanifest,
              revokeFiniteAllocationPackage,
            } = await import("../modules/ai/inference-allocation-package");
            const packageOf = (kind: keyof typeof finitePackagePreparers) =>
              prepareFiniteAllocationPackage(new Date(Date.now() - 60_000), finitePackagePreparers[kind]);
            const approve = (pkg: Awaited<ReturnType<typeof packageOf>>) =>
              approveFiniteAllocationPackage(
                scoped,
                pkg,
                {
                  confirmPackageId: allocationPackageId(pkg),
                  approvedBy: "synthetic-owner",
                  reference: "Synthetic approval in a disposable schema, not the owner's",
                  hours: 1,
                },
                schema,
              );
            const admit = (packageId: string, packageExpiresAt: string) =>
              registerPreparedInferenceSubmanifest(
                store,
                { ...manifest, packageId },
                new Date(
                  Math.min(Date.parse(packageExpiresAt), Date.parse(plan.manifest.expiresAt)),
                ).toISOString(),
                assertFiniteWorkBindings,
              );
            const callsBeforeAdmission = calls;
            // A package of the guides' kind that nobody has approved admits nothing.
            const guidePackage = await packageOf("guidePairs");
            await assert.rejects(
              admit(allocationPackageId(guidePackage), new Date(Date.now() + 3_600_000).toISOString()),
              /ALLOCATION_PACKAGE_NOT_AUTHORIZED/,
            );
            // An approval of template reviews does not admit a guide's reviews.
            const templates = await approve(await packageOf("templatePairs"));
            await assert.rejects(
              admit(templates.packageId, templates.expiresAt),
              /PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE/,
            );
            await revokeFiniteAllocationPackage(scoped, templates.packageId, schema);
            // And a guide package cannot be approved: the publisher releases a guide only after the
            // owner's source check (decision 0018), so its reviews would release nothing.
            await assert.rejects(approve(guidePackage), /GUIDE_REVIEWS_RELEASE_NOTHING/);
            assert.deepEqual(
              (
                await scoped.query("SELECT id FROM valo_inference_batches WHERE id=$1", [
                  allocationPackageId(guidePackage),
                ])
              ).rows,
              [],
              "no approval is recorded",
            );
            assert.equal(calls, callsBeforeAdmission, "refusing calls no model");
            assert.equal((await state()).entries.length, 0, "and reserves nothing");
            assert.equal(await savedVersion(prepared.id), undefined, "nothing is saved");
            assert.ok(!(await liveReleasedVersions()).some((version) => version.id === prepared.id));
            assert.ok(!(await releasedResources()).some((resource) => resource.id === prepared.id));
          } finally {
            guideApproval.absent = false;
            t.mock.timers.enable({ apis: ["Date"], now: clockBefore });
          }
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
