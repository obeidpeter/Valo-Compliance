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
import { digest, evaluatePublication, mandatoryEnhancedChecks } from "@workspace/valo-core";

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
      for (const role of [
        "valo_content_drafter_dev",
        "valo_content_reviewer_dev",
        "valo_content_publisher_dev",
      ]) {
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
        // The development owner, and whether the owner checked a guide's sources (decision 0018): the
        // owner's check of a guide and the guide's admission and release read the fixture schema's rows.
        "valo_manual_regulatory_owner(text)",
        "valo_reviewed_guide_checked(uuid,text,jsonb)",
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
      // The reviews record their attempts as the reviewer role, with what migration reviewer_login grants it.
      await scoped.query(`GRANT USAGE ON SCHEMA "${schema}" TO valo_content_reviewer_dev`);
      await scoped.query(
        `GRANT SELECT, INSERT (candidate_hash, role, request_hash, request_meter, outcome),
          UPDATE (outcome, provider_response_id, input_tokens, output_tokens, error_code, completed_at)
          ON "${schema}".valo_publication_ai_attempts TO valo_content_reviewer_dev`,
      );
      await scoped.query(
        `GRANT USAGE ON SEQUENCE "${schema}".fixture_attempt_ids TO valo_content_reviewer_dev`,
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
      // them through this one pool: drafting, the reviews' records and the release run on it too, not on
      // the real drafting, review and publisher logins. The check that drafting can log in finds
      // drafting on this schema.
      t.mock.module("@workspace/db", {
        namedExports: {
          ...database,
          db: drizzle(scoped),
          pool: scoped,
          drafterDb: () => drizzle(scoped),
          reviewerDb: () => drizzle(scoped),
          publisherDb: () => drizzle(scoped),
        },
      });
      t.mock.module(new URL("../modules/publication/drafting-login.ts", import.meta.url).href, {
        namedExports: {
          assertDrafterCanLogIn: async () =>
            assert.equal((await scoped.query("SELECT current_schema() AS name")).rows[0].name, schema),
        },
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
      // A rule on the reviewed route is covered only by a rights record the owner chooses for that route,
      // and none is chosen (docs/architecture/reviewed-route.md, part 3). For the rule subtest at the end,
      // the business-name rule is given a synthetic one; the owner's route reads no such record.
      const realRuleCandidates = await import("../modules/editorial/owner-rule-candidates");
      const ruleRightsEvidence =
        "Synthetic rights record for a test of the reviewed route; not the owner's choice.";
      t.mock.module(new URL("../modules/editorial/owner-rule-candidates.ts", import.meta.url).href, {
        namedExports: {
          ...realRuleCandidates,
          ownerRuleCandidates: realRuleCandidates.ownerRuleCandidates.map((c) =>
            c.rule.id === "cac-business-name-814"
              ? {
                  ...c,
                  reviewedRouteRights: {
                    status: "cleared" as const,
                    evidence: ruleRightsEvidence,
                    evidenceHash: sha(Buffer.from(ruleRightsEvidence)),
                    commercialUse: true,
                  },
                }
              : c,
          ),
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
      // docs/architecture/reviewed-route.md, part 1: once the template's next version is released, the
      // version before it is replaced. It leaves the catalogue, its file and a new document from it are
      // refused, and a document made from it stays the customer's and reads replaced.
      await t.test(
        "a version replaced by the next one the real publisher releases closes to new downloads and new documents",
        async () => {
          await reset();
          answer = async () => passing();
          const {
            createReleasedTemplateDraft,
            listDocumentEditions,
            liveReleasedVersions,
            readReleasedMaster,
          } = await import("../modules/catalogue");
          const { resolveWorkspace } = await import("../modules/workspaces");
          const reader = await resolveWorkspace(`synthetic-replaced-reader-${randomUUID()}`);
          const live = async () =>
            (await liveReleasedVersions()).filter((r) => r.templateId === "TPL-07").map((r) => r.id);
          // The version the subtest before this one released is the template's live one.
          const [first] = await live();
          assert.ok(first, "the released version is live");
          const firstVersion = (await savedVersion(first)).version;
          const made = await createReleasedTemplateDraft(reader, first);
          // The next version is prepared, reviewed and released the same way.
          const fixture = await operational();
          const reviews = await fixture.execute(),
            second = versionOf(fixture);
          assert.equal(
            (
              await publish(
                fixture.id,
                reviews.map((r) => r.artifact),
              )
            ).status,
            "published",
          );
          const secondRow = await savedVersion(second);
          assert.equal(secondRow.version, firstVersion + 1);
          // The catalogue lists the new version alone.
          assert.deepEqual(await live(), [second]);
          // The replaced version's file, and a new document from it, are refused.
          const replaced = { status: 404, message: /A newer version of this template was released/ };
          await assert.rejects(readReleasedMaster(first, "docx", reader), replaced);
          await assert.rejects(readReleasedMaster(first, "pdf", reader), replaced);
          await assert.rejects(createReleasedTemplateDraft(reader, first), replaced);
          // The new version's file is served, the one its release recorded, and a document starts from it.
          const file = await readReleasedMaster(second, "docx", reader);
          assert.equal(file.version, firstVersion + 1);
          assert.equal(sha(file.bytes), secondRow.attestations.exports.docx.hash);
          const current = await createReleasedTemplateDraft(reader, second);
          // The document made from the replaced version reads replaced, with the new version; the one made
          // from the new version reads nothing.
          const { items } = await listDocumentEditions(reader);
          assert.deepEqual(
            items.map((item) => [item.documentId, item.version, item.state, item.current?.version]),
            [[made.id, firstVersion, "replaced", firstVersion + 1]],
          );
          assert.ok(!items.some((item) => item.documentId === current.id));
          // The document made from the replaced version is unchanged (DOC-007).
          const { getDocument } = await import("../modules/documents");
          const kept = await getDocument(reader, made.id);
          assert.deepEqual([kept.title, kept.content], [made.title, made.content]);
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
      // captures made of the passages kept in the repository. Its pair of reviews is admitted and sent only
      // once the development owner has checked the guide's sources, and the publisher releases it only on
      // that check (decision 0018; docs/architecture/reviewed-route.md, part 2). The approvals of AI spending
      // are synthetic ones recorded in this schema, and the model is the stand-in above.
      await t.test(
        "a guide's review pair is admitted only after the owner's check of its sources, and the publisher then releases it",
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
          const { REVIEW_INPUT_CEILING } = await import("../modules/editorial/review-meter");
          const { checkReviewedGuideSources, listReviewedGuides } =
            await import("../modules/editorial/reviewed-guide-checks");
          const { ListReviewedGuidesResponse } = await import("@workspace/api-zod");
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
            // Before the development owner has checked the guide's sources, nothing admits its reviews:
            // the binding checks refuse them before any package is read.
            const guidePackage = await packageOf("guidePairs");
            await assert.rejects(
              admit(allocationPackageId(guidePackage), new Date(Date.now() + 3_600_000).toISOString()),
              /OWNER_SOURCE_CHECK_REQUIRED/,
            );
            assert.equal(calls, callsBeforeAdmission, "refusing calls no model");
            assert.equal((await state()).entries.length, 0, "and reserves nothing");

            // The development owner is the identity the operator's bootstrap granted (decision 0018).
            const {
              db: fixtureDb,
              valoStaffAssignments,
              valoStaffRoleChanges,
            } = await import("@workspace/db");
            const owner = `synthetic-guide-owner-${randomUUID()}`,
              assignment = randomUUID();
            await fixtureDb.insert(valoStaffAssignments).values({
              id: assignment,
              identityId: owner,
              role: "system",
              grantedBy: "synthetic operator",
              reason: "Synthetic owner of a guide's source check",
            });
            await fixtureDb.insert(valoStaffRoleChanges).values({
              id: randomUUID(),
              requestKey: randomUUID(),
              inputHash: sha(Buffer.from("synthetic")),
              actorId: "operator-bootstrap:synthetic",
              actorAssignmentId: assignment,
              assignmentId: assignment,
              targetIdentityId: owner,
              action: "grant",
              role: "system",
              reason: "Synthetic development owner fixture",
              after: { active: true },
              targetVerifiedAt: new Date(),
            });
            const ownerCheck = (confirm = current.candidate.hash) =>
              checkReviewedGuideSources(
                { identityId: owner, recentMfa: true, verifiedAt: Date.now() },
                prepared.id,
                confirm,
              );
            // Nobody else checks a guide's sources, and a check of other words than the candidate's
            // records nothing.
            await assert.rejects(
              checkReviewedGuideSources(
                {
                  identityId: `synthetic-not-the-owner-${randomUUID()}`,
                  recentMfa: true,
                  verifiedAt: Date.now(),
                },
                prepared.id,
                current.candidate.hash,
              ),
              { status: 403 },
            );
            await assert.rejects(ownerCheck("f".repeat(64)), /changed since you opened it/);
            const checks = async () =>
              (
                await scoped.query(
                  "SELECT checked_by, candidate_hash, captures FROM valo_reviewed_guide_checks WHERE version_id=$1",
                  [prepared.id],
                )
              ).rows;
            assert.deepEqual(await checks(), []);
            // The owner's panel lists the guide as it would be checked now, through the contract's own
            // schema: its whole text, each sentence with the passage it rests on, where each source's copy
            // stands, and nothing holding it. Nobody else reads it.
            const listed = async () =>
              ListReviewedGuidesResponse.parse(
                await listReviewedGuides({ identityId: owner, recentMfa: true, verifiedAt: Date.now() }),
              ).items.find((item) => item.versionId === prepared.id);
            await assert.rejects(
              listReviewedGuides({
                identityId: `synthetic-not-the-owner-${randomUUID()}`,
                recentMfa: true,
                verifiedAt: Date.now(),
              }),
              { status: 403 },
            );
            const candidate = current.bundle.candidate;
            const shown = (await listed())!;
            assert.deepEqual(
              [shown.guideId, shown.version, shown.candidateHash, shown.saved, shown.holds, shown.lastCheck],
              [guide, candidate.version, current.candidate.hash, false, [], null],
            );
            assert.equal(shown.title, (JSON.parse(candidate.body) as { title: string }).title);
            assert.ok(shown.text.some((part) => part.includes(shown.claims[0]!.text)));
            assert.deepEqual(
              shown.claims.map((c) => [c.text, c.sourceId, c.quote, c.held]),
              candidate.claims.map((c) => [c.text, c.sourceId, c.quote, false]),
            );
            assert.deepEqual(
              shown.sources.map((s) => [s.id, s.passage, s.state]),
              current.bundle.sources.map((s) => [s.id, s.text, "holds"]),
            );
            // Nor does a check while the Act's capture was last checked over a day ago, or once the Act's
            // file has changed since that capture: the daily check must have found it current. The panel
            // says which, for each source, and that it holds the guide.
            const watch = (column: "checked_at" | "last_raw_hash", value: unknown) =>
              scoped.query(`UPDATE valo_source_watches SET ${column} = $2 WHERE source_id = $1`, [
                leadId,
                value,
              ]);
            const notCurrent = /no longer the current one, or was not checked within the last day/;
            const panelSays = async (state: string, hold: RegExp) => {
              const now = (await listed())!;
              assert.ok(
                now.sources.every((s) => s.state === state),
                state,
              );
              assert.ok(now.holds.length > 0 && now.holds.every((h) => hold.test(h)), now.holds.join(" "));
            };
            await watch("checked_at", new Date(Date.now() - 86_460_000));
            await assert.rejects(ownerCheck(), notCurrent);
            await panelSays("not_current", /was not checked within the last day/);
            await watch("checked_at", checkedAt);
            await watch("last_raw_hash", "e".repeat(64));
            await assert.rejects(ownerCheck(), notCurrent);
            await panelSays("changed", /has changed since this guide was prepared/);
            await watch("last_raw_hash", rawChecksum);
            assert.deepEqual(await checks(), []);
            assert.deepEqual((await listed())!.holds, []);
            // The owner's check of the exact candidate, through the captures its sources are bound to.
            const captures = (current.row.attestations as { sourceSnapshots: Record<string, string> })
              .sourceSnapshots;
            const checked = await ownerCheck();
            assert.deepEqual(
              [checked.guide, checked.versionId, checked.candidateHash, checked.sources],
              [guide, prepared.id, current.candidate.hash, Object.keys(captures).length],
            );
            assert.ok(checked.sources > 0);
            assert.deepEqual(await checks(), [
              { checked_by: owner, candidate_hash: current.candidate.hash, captures },
            ]);
            // The panel shows the check and the day it counts for (the contract's schema reads times as dates).
            assert.deepEqual((await listed())!.lastCheck, {
              checkedAt: new Date(checked.checkedAt),
              countsUntil: new Date(Date.parse(checked.checkedAt) + 86_400_000),
              counts: true,
            });

            // With the check, a package of the guides' kind that nobody has approved still admits nothing,
            // and an approval of template reviews does not admit a guide's reviews.
            await assert.rejects(
              admit(allocationPackageId(guidePackage), new Date(Date.now() + 3_600_000).toISOString()),
              /ALLOCATION_PACKAGE_NOT_AUTHORIZED/,
            );
            const templates = await approve(await packageOf("templatePairs"));
            await assert.rejects(
              admit(templates.packageId, templates.expiresAt),
              /PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE/,
            );
            await revokeFiniteAllocationPackage(scoped, templates.packageId, schema);

            // Under an approval of guide reviews, the pair is admitted, and approving and admitting call no
            // model and reserve nothing.
            const guides = await approve(guidePackage);
            const admitted = await admit(guides.packageId, guides.expiresAt);
            assert.equal(admitted.packageId, guides.packageId);
            assert.match(admitted.batchId, /^finite-submanifest:[a-f0-9]{64}$/);
            assert.equal(calls, callsBeforeAdmission, "approving and admitting call no model");
            assert.equal((await state()).entries.length, 0, "and reserve nothing");
            const id = admitted.batchId,
              pair = manifest.works[0]!.pair!;

            // The stand-in answers each request with a pass and the five enhanced checks, each quoting the
            // first source the request itself carries. It is not a review.
            answer = async (request) => {
              const sent = JSON.parse((request.messages[1] as { content: string }).content) as {
                sources: { text: string }[];
              };
              return response(
                JSON.stringify({
                  verdict: "pass",
                  findings: [],
                  missingEvidence: [],
                  observations: ["Controlled fixture; not a genuine review"],
                  enhancedChecks: mandatoryEnhancedChecks.map((name) => ({
                    name,
                    result: "pass",
                    passage: sent.sources[0]!.text.slice(0, 200),
                    note: "Controlled fixture; not a genuine check",
                  })),
                }),
              );
            };
            const before = calls,
              sentBefore = captured.length;
            const sendReviews = () =>
              run(() =>
                withApprovedInferencePair(id, pair, () =>
                  executeOperationalReviewPlan(plan, current.candidate, current.serverEvidence),
                ),
              );
            // In this disposable copy, a check's time is moved back as if the owner had checked a day and a
            // minute ago.
            const backdateChecks = () =>
              scoped.query(
                "UPDATE valo_reviewed_guide_checks SET checked_at = checked_at - interval '1 day 1 minute' WHERE version_id=$1",
                [prepared.id],
              );
            // A day after the owner's check, the admitted pair is not sent and the guides' approval admits
            // it no more: the owner checks again.
            await backdateChecks();
            assert.equal(
              (await listed())!.lastCheck!.counts,
              false,
              "the panel says the check no longer counts",
            );
            await assert.rejects(sendReviews(), /OWNER_SOURCE_CHECK_REQUIRED/);
            await assert.rejects(admit(guides.packageId, guides.expiresAt), /OWNER_SOURCE_CHECK_REQUIRED/);
            assert.equal(calls, before, "refusing calls no model");
            assert.equal(captured.length, sentBefore, "and sends nothing");
            assert.equal((await state()).entries.length, 0, "and reserves nothing");
            await ownerCheck();
            const reviews = await sendReviews();
            assert.equal(reviews.length, 2);
            assert.equal(calls - before, 2, "one call to the stand-in for each review");
            // Both were charged to the batch admitted under the guides' approval.
            assert.deepEqual(
              (await state()).entries.map((e) => [e.runKey.startsWith(`${id}:`), e.lane, e.status]),
              [
                [true, "publication", "settled"],
                [true, "publication", "settled"],
              ],
            );
            // What was sent is what was planned: a guide's request, larger than a template's may be.
            assert.deepEqual(
              captured
                .slice(sentBefore)
                .map((request) => requestDigest(request))
                .sort(),
              plan.entries.map((entry) => entry.meter.requestHash).sort(),
            );
            for (const entry of plan.entries) {
              assert.ok(entry.meter.withinInputCeiling);
              assert.ok(entry.meter.conservativeInputTokenBound > REVIEW_INPUT_CEILING);
            }
            assert.equal(
              await savedVersion(prepared.id),
              undefined,
              "nothing is saved before the reviews are checked",
            );

            // A day after the owner's check, the guide is neither saved nor released, and its reviews
            // stand: the owner checks again.
            const artifacts = reviews.map((r) => r.artifact);
            await backdateChecks();
            await assert.rejects(publish(id, artifacts), /OWNER_SOURCE_CHECK_REQUIRED/);
            assert.equal(
              await savedVersion(prepared.id),
              undefined,
              "nothing is saved without a current check",
            );
            await ownerCheck();

            // With the owner's current check, the real publisher releases the guide, with both reviews
            // and the five enhanced checks they ran recorded as passed.
            const result = await publish(id, artifacts);
            assert.equal(result.eligibility?.decision, "eligible");
            assert.equal(result.status, "published");
            assert.equal(await listed(), undefined, "a released guide needs no check, and leaves the panel");
            const row = await savedVersion(prepared.id);
            assert.equal(row.status, "published");
            assert.equal(evaluatePublication(row.bundle).decision, "eligible");
            assert.equal(row.bundle.candidate.id, guide);
            assert.equal(row.bundle.candidate.contentClass, "sourced_guidance");
            assert.equal(row.bundle.policy.ownerApproved, true);
            assert.equal(row.bundle.policy.hash, (await realGuidancePolicy.guidancePolicy()).policy.hash);
            assert.deepEqual(
              row.bundle.enhancedChecks.map((c: { name: string; result: string }) => [c.name, c.result]),
              mandatoryEnhancedChecks.map((name) => [name, "pass"]),
            );
            assert.deepEqual(
              row.bundle.reviews.map((r: { role: string; verdict: string }) => [r.role, r.verdict]),
              [
                ["factual", "pass"],
                ["challenge", "pass"],
              ],
            );
            // Its sources are bound to the captures the owner checked.
            const bound = await scoped.query(
              "SELECT bundle_source_id, snapshot_id FROM valo_source_release_bindings WHERE target_kind='content' AND target_id=$1 ORDER BY bundle_source_id",
              [prepared.id],
            );
            assert.deepEqual(
              Object.fromEntries(bound.rows.map((b) => [b.bundle_source_id, b.snapshot_id])),
              captures,
            );
            assert.deepEqual(
              (
                await scoped.query("SELECT action FROM valo_publication_audit WHERE version_id=$1", [
                  prepared.id,
                ])
              ).rows.map((r) => r.action),
              ["published"],
            );
            assert.equal(calls - before, 2, "publication makes no further model request");
            // The guide is on the site while the policy it was released under stands, and not once its
            // approval is supposed absent.
            assert.ok((await liveReleasedVersions()).some((version) => version.id === prepared.id));
            assert.ok((await releasedResources()).some((resource) => resource.id === prepared.id));
            guideApproval.absent = true;
            assert.ok(!(await liveReleasedVersions()).some((version) => version.id === prepared.id));
            assert.ok(!(await releasedResources()).some((resource) => resource.id === prepared.id));
          } finally {
            guideApproval.absent = false;
            t.mock.timers.enable({ apis: ["Date"], now: clockBefore });
          }
        },
      );
      // docs/architecture/reviewed-route.md, part 3: a requirements-check rule prepared in the repository is
      // built for the reviewed route from the capture the daily check holds of its official source, and its
      // two reviews are admitted and sent only under an approval of rule reviews, each time built again from
      // the rule's own sources and records. The rights record for this route is the synthetic one stood in
      // above; the approvals of AI spending are synthetic ones recorded in this schema, and the model is the
      // stand-in. Nothing is released.
      await t.test(
        "a rule's review pair is admitted only under an approval of rule reviews, and sent only as built again from its own sources",
        async () => {
          await reset();
          const { prepareReviewedRuleCandidate, readReviewedRuleReadiness } =
            await import("../modules/editorial/reviewed-rule-preparation");
          const { executeRuleReviewPlan, RULE_REVIEW_LANE, RULE_REVIEW_PREPARER, saveRuleReviewPlan } =
            await import("../modules/editorial/reviewed-rule-review");
          const { REVIEWED_ROUTE_RIGHTS_MISSING } = await import("../modules/editorial/reviewed-rule");
          const { ownerRuleCandidates } = await import("../modules/editorial/owner-rule-candidates");
          const { retainedGuidePassages } = await import("../modules/publication/guidance-passages");
          const { guideAmendmentRecords } = await import("../modules/publication/guidance-amendments");
          const { db: fixtureDb } = await import("@workspace/db");
          const clockBefore = Date.now();
          // On the real clock, as the guide's subtest runs, and for the same reasons: the database stamps
          // approvals, admissions and attempts with the real time.
          t.mock.timers.reset();
          try {
            const now = new Date(),
              checkedAt = new Date(+now - 3_600_000);
            // The capture the daily check would hold of the Act the rule quotes (SV-010): the passage kept
            // in the repository, under the checksum the Act's amendment record describes.
            const passage = retainedGuidePassages()("CAMA-814")!;
            const rawChecksum = guideAmendmentRecords.find(
              (r) => r.instrument === passage.instrument.id,
            )!.rawSha256;
            const snapshotId = randomUUID(),
              text = `Front matter.\n\f\n${passage.text}\n\f\nMore of the Act.`;
            captureTexts.set(snapshotId, text);
            await scoped.query(
              `INSERT INTO valo_source_snapshots(id,source_id,url,final_url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,extraction_version,metadata)
               VALUES($1,'SV-010',$2,$2,$3,$3,'retrieved_unreviewed',200,'application/pdf',$4,$5,'synthetic-in-memory','synthetic-in-memory','synthetic','{"synthetic":true}')`,
              [snapshotId, passage.instrument.url, checkedAt, rawChecksum, sha(Buffer.from(text))],
            );
            await scoped.query(
              `INSERT INTO valo_source_watches(source_id,url,risk,last_snapshot_id,last_raw_hash,checked_at,failure_code)
               VALUES('SV-010',$1,'high',$2,$3,$4,null)
               ON CONFLICT (source_id) DO UPDATE SET url = excluded.url, last_snapshot_id = excluded.last_snapshot_id,
                 last_raw_hash = excluded.last_raw_hash, checked_at = excluded.checked_at, failure_code = null`,
              [passage.instrument.url, snapshotId, rawChecksum, checkedAt],
            );
            const releases = async () =>
              (
                await scoped.query(
                  "SELECT count(*)::int AS n FROM valo_rule_releases WHERE rule_id = 'cac-business-name-814'",
                )
              ).rows[0].n;
            const releasedBefore = await releases();

            // A rule with no rights record for this route keeps nothing.
            const ntaa = ownerRuleCandidates.find(
              (c) => c.rule.requirementVersionId === "NTAA-11-COMPANY-RETURN",
            )!;
            const heldRule = await prepareReviewedRuleCandidate(ntaa.rule.id);
            assert.equal(heldRule.state, "held");
            assert.ok(heldRule.reasons.includes(REVIEWED_ROUTE_RIGHTS_MISSING), heldRule.reasons.join("; "));

            // The business-name rule is prepared from the stored capture, as the operator's command prepares it.
            const prepared = await prepareReviewedRuleCandidate("cac-business-name-814");
            assert.equal(prepared.state, "awaiting_reviews", prepared.reasons.join(", "));
            assert.ok(prepared.candidateArtifact && prepared.id);
            const binding = {
              candidateVersionId: prepared.id,
              candidateArtifact: prepared.candidateArtifact,
            };
            const current = await readReviewedRuleReadiness(binding);
            assert.equal(current.candidate.hash, prepared.candidateHash);
            assert.deepEqual(
              [
                current.serverEvidence.ruleId,
                current.serverEvidence.version,
                current.serverEvidence.sourceSnapshots,
                current.serverEvidence.authoringRoute,
              ],
              ["cac-business-name-814", prepared.version, { "cama-814": snapshotId }, "repository-rule"],
            );
            // Each scenario goes to the reviewers with its answers, its date and what the check gives for it.
            const scenarios = current.reviewInputs.scenarios as {
              id: string;
              passed: boolean;
              facts: unknown;
              asOfDate: string;
            }[];
            assert.deepEqual(
              scenarios.map((s) => [s.id, s.passed, s.asOfDate]),
              current.prepared.scenarios.map((s) => [s.id, true, s.asOfDate]),
            );
            assert.ok(scenarios.every((s) => s.facts));

            // Its two requests are kept as a plan of their own lane, not reserved.
            const plan = await saveRuleReviewPlan(
              current.candidate,
              current.reviewInputs,
              current.serverEvidence,
              undefined,
              current.bundle.sources,
            );
            assert.deepEqual(
              [plan.manifest.lane, plan.manifest.preparer, plan.manifest.status],
              [RULE_REVIEW_LANE, RULE_REVIEW_PREPARER, "mechanically_planned_not_reserved"],
            );
            assert.ok(
              Date.parse(plan.manifest.expiresAt) <= Date.parse(plan.manifest.preparedAt) + 3_600_000,
            );
            assert.ok(plan.manifest.entries.every((entry) => !("request" in entry)));
            const manifest = prepareOperationalFiniteManifest({
              ...binding,
              candidateHash: current.candidate.hash,
              bundleHash: requestDigest(current.bundle),
              sourceHashes: current.bundle.sources.map((source) => source.hash),
              sourceFiles: [],
              plan,
            });

            const {
              allocationPackageId,
              approveFiniteAllocationPackage,
              finitePackagePreparers,
              prepareFiniteAllocationPackage,
              registerPreparedInferenceSubmanifest,
              revokeFiniteAllocationPackage,
            } = await import("../modules/ai/inference-allocation-package");
            // One approval is current at a time: the earlier subtests' approvals are revoked first.
            for (const row of (
              await scoped.query(
                "SELECT id FROM valo_inference_batches WHERE id LIKE 'finite-package:%' AND enabled AND approved_at IS NOT NULL",
              )
            ).rows)
              await revokeFiniteAllocationPackage(scoped, row.id, schema);
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
            // Nobody has approved the package of rule reviews, so it admits nothing.
            const rulePackage = await packageOf("rulePairs");
            await assert.rejects(
              admit(allocationPackageId(rulePackage), new Date(Date.now() + 3_600_000).toISOString()),
              /ALLOCATION_PACKAGE_NOT_AUTHORIZED/,
            );
            // An approval of another kind of work does not admit a rule's pair.
            for (const kind of ["templatePairs", "guidePairs", "checkerChallenges"] as const) {
              const other = await approve(await packageOf(kind));
              await assert.rejects(admit(other.packageId, other.expiresAt), /WORK_OUTSIDE_PACKAGE/);
              await revokeFiniteAllocationPackage(scoped, other.packageId, schema);
            }
            // Under an approval of rule reviews the pair is admitted; approving and admitting call no model
            // and reserve nothing.
            const rules = await approve(rulePackage);
            const admitted = await admit(rules.packageId, rules.expiresAt);
            assert.equal(admitted.packageId, rules.packageId);
            assert.match(admitted.batchId, /^finite-submanifest:[a-f0-9]{64}$/);
            assert.equal(calls, callsBeforeAdmission, "approving and admitting call no model");
            assert.equal((await state()).entries.length, 0, "and reserve nothing");
            const id = admitted.batchId,
              pair = manifest.works[0]!.pair!;

            // The binding checks build the pair again from the rule: a work whose bundle or request is not
            // the one built is refused.
            const [factual, challenge] = manifest.works as [
              (typeof manifest.works)[number],
              (typeof manifest.works)[number],
            ];
            await assert.rejects(
              assertFiniteWorkBindings({ ...factual, caseHash: "f".repeat(64) }),
              /PUBLICATION_BUNDLE_CHANGED/,
            );
            await assert.rejects(
              assertFiniteWorkBindings({ ...factual, request: challenge.request }),
              /OPERATIONAL_PLAN_REQUEST_CHANGED/,
            );
            // A plan whose requests the rule's own inputs do not build is refused, even with works that
            // match it: here, one that would keep the scenarios from the reviewers.
            const forged = await saveRuleReviewPlan(
              current.candidate,
              { ...current.reviewInputs, scenarios: [] },
              current.serverEvidence,
              undefined,
              current.bundle.sources,
            );
            const forgedManifest = prepareOperationalFiniteManifest({
              ...binding,
              candidateHash: current.candidate.hash,
              bundleHash: requestDigest(current.bundle),
              sourceHashes: current.bundle.sources.map((source) => source.hash),
              sourceFiles: [],
              plan: forged,
            });
            await assert.rejects(
              assertFiniteWorkBindings(forgedManifest.works[0]!),
              /OPERATIONAL_PLAN_REQUEST_CHANGED/,
            );
            // The rule is built again under the guidance policy as it stands: with the policy's approval
            // supposed absent, it is not the rule that was kept.
            guideApproval.absent = true;
            try {
              await assert.rejects(assertFiniteWorkBindings(factual), /SAVED_PLAN_INPUT_CHANGED/);
            } finally {
              guideApproval.absent = false;
            }
            // Once a version of the rule is stored under its number, on either route, its review ends. The
            // stored version here is a synthetic withdrawn one, taken away again.
            const releaseId = randomUUID();
            await scoped.query(
              `INSERT INTO valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
               VALUES($1,'cac-business-name-814',$2,'withdrawn',$3,'{"synthetic":true}',$4,now())`,
              [
                releaseId,
                prepared.version,
                JSON.stringify({ id: "cac-business-name-814", version: prepared.version, synthetic: true }),
                "b".repeat(64),
              ],
            );
            try {
              await assert.rejects(assertFiniteWorkBindings(factual), /CANDIDATE_ALREADY_SAVED/);
            } finally {
              await scoped.query("DELETE FROM valo_rule_releases WHERE id = $1", [releaseId]);
            }
            assert.equal(calls, callsBeforeAdmission, "the refusals call no model");

            // The stand-in answers each request with a pass and the five enhanced checks, each quoting the
            // first source the request itself carries. It is not a review.
            answer = async (request) => {
              const sent = JSON.parse((request.messages[1] as { content: string }).content) as {
                sources: { text: string }[];
              };
              return response(
                JSON.stringify({
                  verdict: "pass",
                  findings: [],
                  missingEvidence: [],
                  observations: ["Controlled fixture; not a genuine review"],
                  enhancedChecks: mandatoryEnhancedChecks.map((name) => ({
                    name,
                    result: "pass",
                    passage: sent.sources[0]!.text.slice(0, 200),
                    note: "Controlled fixture; not a genuine check",
                  })),
                }),
              );
            };
            const before = calls,
              sentBefore = captured.length;
            const sendReviews = () =>
              run(() =>
                withApprovedInferencePair(id, pair, () =>
                  executeRuleReviewPlan(plan, current.candidate, current.serverEvidence),
                ),
              );
            // While the Act's file has changed since the capture the rule is bound to, nothing is sent: the
            // daily check must find the capture current, as the rule's release will.
            const watch = (value: string) =>
              scoped.query("UPDATE valo_source_watches SET last_raw_hash = $2 WHERE source_id = $1", [
                "SV-010",
                value,
              ]);
            await watch("e".repeat(64));
            await assert.rejects(sendReviews(), /SOURCE_CURRENT_CAPTURE_REQUIRED/);
            assert.equal(calls, before, "refusing calls no model");
            assert.equal(captured.length, sentBefore, "and sends nothing");
            assert.equal((await state()).entries.length, 0, "and reserves nothing");
            await watch(rawChecksum!);

            const reviews = await sendReviews();
            assert.equal(reviews.length, 2);
            assert.equal(calls - before, 2, "one call to the stand-in for each review");
            // Both were charged to the batch admitted under the approval of rule reviews.
            assert.deepEqual(
              (await state()).entries.map((e) => [e.runKey.startsWith(`${id}:`), e.lane, e.status]),
              [
                [true, "publication", "settled"],
                [true, "publication", "settled"],
              ],
            );
            // What was sent is what was planned: the rule's own two requests, each with the rule, its
            // scenarios and its sources.
            const sentRequests = captured.slice(sentBefore);
            assert.deepEqual(
              sentRequests.map((request) => requestDigest(request)).sort(),
              plan.entries.map((entry) => entry.meter.requestHash).sort(),
            );
            for (const request of sentRequests) {
              const input = JSON.parse((request.messages[1] as { content: string }).content) as {
                candidate: { hash: string };
                scenarios: unknown[];
                sources: { id: string }[];
              };
              assert.equal(input.candidate.hash, current.candidate.hash);
              assert.equal(input.scenarios.length, scenarios.length);
              assert.deepEqual(
                input.sources.map((source) => source.id),
                ["cama-814"],
              );
            }
            // Nothing is released: the reviews are AI checks, and the rule is released only by the
            // reviewed route's release command.
            assert.equal(await releases(), releasedBefore);
            assert.deepEqual(
              reviews.map((r) => r.record.role),
              ["factual", "challenge"],
            );

            // Slice 3b: with both reviews passed, the rule's release request is assembled from the batch.
            // Each review must be the one the batch settled, and the rule is built again first.
            const { assembleReviewedRuleRelease, readReviewedRuleReleaseRequest } =
              await import("../modules/ai-lanes/inference-reviewed-rule-release");
            const { applyStoredRuleRelease, planStoredRuleRelease } =
              await import("../modules/editorial/valo-rule-release");
            const { releasedRegistry } = await import("../modules/rules/valo-assessments");
            const refs = reviews.map((r) => r.artifact);
            await assert.rejects(
              assembleReviewedRuleRelease({ batchId: id, reviews: [refs[0]!, refs[0]!] }),
              /REVIEWS_NOT_INDEPENDENT/,
            );
            await assert.rejects(
              assembleReviewedRuleRelease({ batchId: id, reviews: refs, reason: "Too short." }),
              /RULE_RELEASE_REASON_INVALID/,
            );
            const reason = "Released on the reviewed route in a test, with stand-in reviews.";
            const assembled = await assembleReviewedRuleRelease({ batchId: id, reviews: refs, reason });
            assert.equal(assembled.state, "ready", assembled.reasons.join("; "));
            assert.ok(assembled.request && assembled.manifestHash);
            assert.deepEqual(
              [assembled.ruleId, assembled.version, assembled.candidateHash],
              ["cac-business-name-814", prepared.version, current.candidate.hash],
            );
            assert.equal(calls - before, 2, "assembling the request calls no model");
            assert.equal(await releases(), releasedBefore, "and releases nothing");
            const request = await readReviewedRuleReleaseRequest(assembled.request);
            assert.deepEqual(request.snapshotIds, { "cama-814": snapshotId });
            assert.equal(request.reason, reason);
            assert.deepEqual(
              (request.bundle as { reviews: { role: string; verdict: string }[] }).reviews.map((r) => [
                r.role,
                r.verdict,
              ]),
              [
                ["factual", "pass"],
                ["challenge", "pass"],
              ],
            );
            // The release command plans it and applies it, confirmed by its manifest hash.
            const releasePlan = await planStoredRuleRelease(request);
            assert.equal(releasePlan.decision, "ready", releasePlan.reasons.join(","));
            await assert.rejects(
              applyStoredRuleRelease(request, "f".repeat(64)),
              /RULE_RELEASE_NOT_CONFIRMED/,
            );
            const applied = await applyStoredRuleRelease(request, assembled.manifestHash);
            assert.deepEqual([applied.ruleId, applied.version], ["cac-business-name-814", prepared.version]);
            assert.equal(await releases(), releasedBefore + 1);
            // The registry admits the reviewed version, and the requirements check reads it.
            const registry = await releasedRegistry(fixtureDb, new Date());
            assert.ok(
              registry.rules.some(
                (r) =>
                  r.id === "cac-business-name-814" &&
                  r.version === prepared.version &&
                  r.provenance === "editorial_release",
              ),
            );
            // The prepared candidate's review has ended: its version is stored.
            await assert.rejects(readReviewedRuleReadiness(binding), /CANDIDATE_ALREADY_SAVED/);
            assert.equal(calls - before, 2, "releasing calls no model");
          } finally {
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
