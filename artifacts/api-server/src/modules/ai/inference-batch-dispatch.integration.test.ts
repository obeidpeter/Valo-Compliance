import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { pool, runInWorkspaceScope } from "@workspace/db";
import { InferenceBudgetStore } from "./inference-budget-store";
import { FiniteInferenceDispatcher, type FiniteWork, type FiniteManifest } from "./inference-batch-dispatch";
import {
  inferenceProposal,
  additionalInferenceAllocation,
  requestDigest,
  budgetUsed,
  tokenCost,
  emptyBudget,
} from "./inference-budget";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
  registerPreparedInferenceSubmanifest,
  readApprovedFiniteAllocationPackage,
} from "./inference-allocation-package";
import type { ManagedCompletionResult } from "./managed-inference";
import { createManagedSDKTransport } from "./managed-sdk-transport";
import {
  managedCompletion,
  withBoundInferenceDispatcher,
  withApprovedInferenceRole,
} from "./managed-inference";
import { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS } from "../../test-support/database-functions";

test(
  "durable finite batch dispatch — isolated PostgreSQL and controlled transport, zero paid calls",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async (t) => {
    const schema = `finite_${randomUUID().replaceAll("-", "")}`,
      c = await pool.connect();
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
    const store = new InferenceBudgetStore(pool, schema, "additional-new");
    const candidateVersionId = randomUUID(),
      planId = randomUUID(),
      candidateArtifact = {
        id: randomUUID(),
        hash: requestDigest("controlled-prepared-candidate"),
        extension: "json" as const,
        templateId: "TPL-07",
      };
    const work = (
      key: string,
      lane: FiniteWork["lane"] = "customer",
      pair: string | null = null,
      role: FiniteWork["role"] = "customer",
    ): FiniteWork => ({
      key,
      lane,
      pair,
      role,
      candidateHash: requestDigest("unchanged-candidate"),
      sourceHashes: [requestDigest("source")],
      caseHash: requestDigest("case"),
      bindings: {
        candidateVersionId: lane === "customer" ? null : candidateVersionId,
        corpus:
          lane === "publication"
            ? null
            : lane === "customer"
              ? "customer-ai"
              : lane === "checker_challenge"
                ? "checker"
                : "editorial",
        caseId: lane === "publication" ? null : "synthetic",
        sourceFiles: [],
        ...(lane === "publication"
          ? {
              operationalPlan: {
                id: planId,
                hash: requestDigest("controlled-plan"),
                extension: "json" as const,
              },
              candidateArtifact: { ...candidateArtifact },
            }
          : {}),
      },
      request: {
        model: "gpt-5.4-mini",
        max_completion_tokens: 8192,
        messages: [{ role: "user", content: `synthetic:${key}` }],
      },
    });
    let sends = 0,
      bindingValid = true;
    const response = (): ManagedCompletionResult => ({
      id: `controlled-${randomUUID()}`,
      model: "gpt-5.4-mini",
      created: 0,
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    });
    const dispatcher = new FiniteInferenceDispatcher(
      store,
      async () => {
        sends++;
        return response();
      },
      async () => {
        if (!bindingValid) throw Error("ACTUAL_BINDING_CHANGED");
      },
    );
    const seed = async (
      works: FiniteWork[],
      enabled = true,
      expires = new Date(Date.now() + 3600000),
      forged = false,
      clock?: { preparedAt: string; approvedAt: Date },
    ) => {
      const id = `controlled-${randomUUID()}`,
        manifest: FiniteManifest = {
          version: 2,
          policyVersion: inferenceProposal.priceVersion,
          preparedAt: clock?.preparedAt ?? new Date().toISOString(),
          allocation: { ...additionalInferenceAllocation },
          works,
        };
      await pool.query(
        `INSERT INTO "${schema}".valo_inference_batches
      (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
      VALUES($1,$2,$3,$4,$5,'controlled-fixture-not-owner','isolated-test-only',$7,$6)`,
        [
          id,
          requestDigest(inferenceProposal),
          forged ? requestDigest("forged") : requestDigest(manifest),
          JSON.stringify(manifest),
          enabled,
          expires,
          clock?.approvedAt ?? new Date(),
        ],
      );
      return id;
    };
    const state = () => store.mutate("inspect", (s) => ({ state: s, value: s }));
    const reset = () =>
      store.mutate("isolated-fixture-reset", () => ({
        state: { ...emptyBudget(), priorUseReconciled: true },
        value: null,
      }));
    const run = (d: FiniteInferenceDispatcher, id: string, w: FiniteWork) =>
      d.withWork(id, w.key, () => d.complete(w.lane, w.request, { timeout: 100, maxRetries: 0 }));
    try {
      await reset();
      await t.test(
        "actual managed entry dispatches all four approved lanes through shared durable reservation, SDK observation and settlement",
        async () => {
          let calls = 0,
            observations = 0;
          const sdk = createManagedSDKTransport(async () => ({
            chat: {
              completions: {
                create: async () => {
                  calls++;
                  return response();
                },
              },
            },
          }));
          const entry = new FiniteInferenceDispatcher(store, sdk, async () => {});
          const complete = (w: FiniteWork) =>
            managedCompletion(w.lane, w.request, {
              timeout: 100,
              maxRetries: 0,
              onOutbound: () => {
                observations++;
              },
            });
          for (const lane of [
            "customer",
            "checker_challenge",
            "publication",
            "editorial_evaluation",
          ] as const) {
            const pair = ["publication", "editorial_evaluation"].includes(lane);
            const works = pair
              ? [
                  work(`${lane}-f`, lane, `${lane}-pair`, "factual"),
                  work(`${lane}-c`, lane, `${lane}-pair`, "challenge"),
                ]
              : [work(`${lane}-one`, lane, null, lane === "customer" ? "customer" : "challenge")];
            const id = await seed(works);
            await withBoundInferenceDispatcher(entry, async () => {
              if (pair)
                await entry.withPair(id, works[0]!.pair!, async () => {
                  for (const w of works)
                    await withApprovedInferenceRole(w.role as "factual" | "challenge", () => complete(w));
                });
              else await entry.withWork(id, works[0]!.key, () => complete(works[0]!));
            });
          }
          assert.equal(calls, 6);
          assert.equal(observations, 6);
          const s = await state();
          assert.equal(s.entries.length, 6);
          assert.ok(s.entries.every((e) => e.status === "settled"));
          assert.equal(budgetUsed(s), tokenCost(120, 40) * 6n);
          await assert.rejects(
            () => managedCompletion("customer", work("unapproved").request, { timeout: 100, maxRetries: 0 }),
            /DISABLED/,
          );
          assert.equal(calls, 6);
          await reset();
        },
      );
      await t.test("disabled durable authority and missing allowlist cannot dispatch", async () => {
        const w = work("disabled"),
          id = await seed([w], false);
        await assert.rejects(() => run(dispatcher, id, w), /NOT_AUTHORIZED/);
        await assert.rejects(
          () => dispatcher.withWork(awaitableId, "not-listed", async () => null),
          /NOT_AUTHORIZED|ALLOWLISTED/,
        );
        assert.equal(sends, 0);
      });
      await t.test(
        "authorized controlled work really dispatches and settles; unchanged result reuses without a call",
        async () => {
          const w = work("one"),
            id = await seed([w]);
          const r = await run(dispatcher, id, w);
          assert.ok(r.id.startsWith("controlled-"));
          const s = await state();
          assert.equal(s.entries[0]!.status, "settled");
          assert.equal(s.entries[0]!.reserved, tokenCost(400000, 8192).toString());
          assert.equal(budgetUsed(s), tokenCost(120, 40));
          const before = sends;
          assert.equal((await run(dispatcher, id, w)).id, r.id);
          assert.equal(sends, before);
        },
      );
      await t.test("PostgreSQL Date timestamps preserve millisecond approval order", async () => {
        await reset();
        const epoch = Math.floor(Date.now() / 1000) * 1000 - 2000;
        const good = work("timestamp-good"),
          goodId = await seed([good], true, new Date(Date.now() + 3600000), false, {
            preparedAt: new Date(epoch + 123).toISOString(),
            approvedAt: new Date(epoch + 789),
          });
        await run(dispatcher, goodId, good);
        const bad = work("timestamp-reversed"),
          badId = await seed([bad], true, new Date(Date.now() + 3600000), false, {
            preparedAt: new Date(epoch + 789).toISOString(),
            approvedAt: new Date(epoch + 123),
          }),
          before = sends;
        await assert.rejects(() => run(dispatcher, badId, bad), /MANIFEST_INVALID/);
        assert.equal(sends, before);
      });
      await t.test("review pair reserves atomically and charges its actual editorial lane", async () => {
        await reset();
        const a = work("factual", "editorial_evaluation", "pair", "factual"),
          b = work("challenge", "editorial_evaluation", "pair", "challenge");
        const id = await seed([a, b]);
        await run(dispatcher, id, a);
        let s = await state();
        assert.equal(s.entries.length, 2);
        assert.equal(s.entries[1]!.status, "reserved");
        assert.ok(s.entries.every((e) => e.lane === "editorial_evaluation"));
        await run(dispatcher, id, b);
        s = await state();
        assert.ok(s.entries.every((e) => e.status === "settled"));
        const ch = work("checker", "checker_challenge", null, "challenge"),
          cid = await seed([ch]);
        await run(dispatcher, cid, ch);
        assert.equal((await state()).entries.at(-1)!.lane, "checker_challenge");
      });
      await t.test(
        "changed request, source bindings, expiry and forged manifest stop before transport",
        async () => {
          const w = work("binding"),
            id = await seed([w]),
            before = sends;
          await assert.rejects(
            () =>
              dispatcher.withWork(id, w.key, () =>
                dispatcher.complete(
                  w.lane,
                  { ...w.request, messages: [{ role: "user", content: "changed" }] },
                  { timeout: 100, maxRetries: 0 },
                ),
              ),
            /REQUEST_MISMATCH/,
          );
          bindingValid = false;
          await assert.rejects(() => run(dispatcher, id, w), /BINDING_CHANGED/);
          bindingValid = true;
          await assert.rejects(
            () =>
              pool.query(
                `UPDATE "${schema}".valo_inference_batches SET
        manifest_hash=$2 WHERE id=$1`,
                [id, requestDigest("forged")],
              ),
            { code: "23514" },
          );
          const expired = await seed([w], true, new Date(Date.now() - 1000));
          await assert.rejects(() => run(dispatcher, expired, w), /EXPIRED/);
          const forged = await seed([w], true, new Date(Date.now() + 3600000), true);
          await assert.rejects(() => run(dispatcher, forged, w), /MANIFEST_INVALID/);
          assert.equal(sends, before);
        },
      );
      await t.test(
        "timeout keeps the whole reservation, duplicates cannot redispatch and new retry consumes another slot",
        async () => {
          await reset();
          let attempts = 0;
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              attempts++;
              throw Error("controlled timeout after acceptance");
            },
            async () => {},
          );
          const a = work("timed"),
            b = work("separate-retry"),
            id = await seed([a, b]);
          await assert.rejects(() => run(d, id, a), /timeout/);
          await assert.rejects(() => run(d, id, a), /ALREADY_DISPATCHED_OR_UNKNOWN/);
          await assert.rejects(() => run(d, id, b), /timeout/);
          const s = await state();
          assert.equal(attempts, 2);
          assert.equal(s.entries.length, 2);
          assert.ok(s.entries.every((e) => e.status === "unknown"));
          assert.equal(budgetUsed(s), 2n * tokenCost(400000, 8192));
        },
      );
      await t.test(
        "concurrency two and duplicate runs cover every lane under one locked ledger",
        async () => {
          await reset();
          let release!: () => void;
          const barrier = new Promise<void>((r) => {
            release = r;
          });
          let calls = 0;
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              calls++;
              await barrier;
              return response();
            },
            async () => {},
          );
          const works = [work("a"), work("b", "checker_challenge", null, "challenge"), work("c")],
            id = await seed(works);
          const first = run(d, id, works[0]!);
          // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- the stubbed provider increments calls while this waits
          while (calls < 1) await new Promise((r) => setTimeout(r, 5));
          await assert.rejects(() => run(d, id, works[0]!), /ALREADY_DISPATCHED_OR_UNKNOWN/);
          const second = run(d, id, works[1]!);
          // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- the stubbed provider increments calls while this waits
          while (calls < 2) await new Promise((r) => setTimeout(r, 5));
          await assert.rejects(() => run(d, id, works[2]!), /CONCURRENCY_EXHAUSTED/);
          release();
          await Promise.all([first, second]);
          assert.equal(calls, 2);
        },
      );
      await t.test("reserved sibling cannot dispatch after first role breaches its bound", async () => {
        await reset();
        let calls = 0;
        const d = new FiniteInferenceDispatcher(
          store,
          async () => {
            calls++;
            return {
              ...response(),
              usage: { prompt_tokens: 400001, completion_tokens: 40, total_tokens: 400041 },
            };
          },
          async () => {},
        );
        const a = work("held-factual", "publication", "hold-pair", "factual"),
          b = work("held-challenge", "publication", "hold-pair", "challenge");
        const id = await seed([a, b]);
        await assert.rejects(
          () =>
            d.withPair(id, "hold-pair", () =>
              d.withRole("factual", () => d.complete(a.lane, a.request, { timeout: 100, maxRetries: 0 })),
            ),
          /RECEIPT_INVALID_OR_BOUND_EXCEEDED/,
        );
        assert.equal((await state()).entries.find((e) => e.runKey.endsWith(b.key))!.status, "reserved");
        await assert.rejects(() => run(d, id, b), /UNRECONCILED/);
        assert.equal(calls, 1);
      });
      await t.test(
        "pair role contexts dispatch their own requests without leaking the other key",
        async () => {
          await reset();
          const seen: string[] = [];
          const d = new FiniteInferenceDispatcher(
            store,
            async (request) => {
              seen.push(requestDigest(request));
              return response();
            },
            async () => {},
          );
          const a = work("context-factual", "publication", "context-pair", "factual"),
            b = work("context-challenge", "publication", "context-pair", "challenge");
          const id = await seed([a, b]);
          await d.withPair(id, "context-pair", () =>
            Promise.all(
              [a, b].map((w) =>
                d.withRole(w.role as "factual" | "challenge", () =>
                  d.complete(w.lane, w.request, { timeout: 100, maxRetries: 0 }),
                ),
              ),
            ),
          );
          assert.deepEqual(seen.sort(), [requestDigest(a.request), requestDigest(b.request)].sort());
          assert.ok((await state()).entries.every((e) => e.status === "settled"));
        },
      );
      await t.test(
        "invalid model or usage retains maximum liability and returns no usable response",
        async () => {
          for (const change of [
            (r: ManagedCompletionResult) => ({ ...r, model: "gpt-5.4-mini-unapproved" }),
            (r: ManagedCompletionResult) => ({ ...r, usage: undefined }),
            (r: ManagedCompletionResult) => ({
              ...r,
              usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 99 },
            }),
          ]) {
            await reset();
            const w = work("invalid-receipt"),
              id = await seed([w]);
            const d = new FiniteInferenceDispatcher(
              store,
              async () => change(response()),
              async () => {},
            );
            await assert.rejects(() => run(d, id, w), /RECEIPT_INVALID/);
            const s = await state();
            assert.equal(s.entries[0]!.status, "unknown");
            assert.equal(budgetUsed(s), tokenCost(400000, 8192));
          }
        },
      );
      await t.test(
        "revocation during transport stops new work but still accounts the admitted receipt",
        async () => {
          await reset();
          const w = work("revoked-flight"),
            next = work("revoked-next"),
            id = await seed([w, next]);
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              await pool.query(`UPDATE "${schema}".valo_inference_batches SET enabled=false WHERE id=$1`, [
                id,
              ]);
              return response();
            },
            async () => {},
          );
          const r = await run(d, id, w);
          assert.ok(r.id);
          assert.equal((await state()).entries[0]!.status, "settled");
          await assert.rejects(() => run(d, id, next), /NOT_AUTHORIZED/);
        },
      );
      await t.test(
        "expiry during transport still accounts its receipt, then denies new dispatch",
        async () => {
          await reset();
          const w = work("expired-flight"),
            next = work("expired-next");
          const id = await seed([w, next], true, new Date(Date.now() + 300));
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              await new Promise((r) => setTimeout(r, 350));
              return response();
            },
            async () => {},
          );
          await run(d, id, w);
          assert.equal((await state()).entries[0]!.status, "settled");
          await assert.rejects(() => run(d, id, next), /EXPIRED/);
        },
      );
      await t.test(
        "schema retry requires a distinct approved key and unknown work cannot cycle batch identity",
        async () => {
          await reset();
          let calls = 0;
          const a = work("first-plan"),
            retry = { ...structuredClone(a), key: "explicit-retry", retryOf: a.key },
            id = await seed([a, retry]);
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              calls++;
              return response();
            },
            async () => {},
          );
          await d.withWork(id, a.key, async () => {
            await d.withAttempt(1, () => d.complete(a.lane, a.request, { timeout: 100, maxRetries: 0 }));
            await d.withAttempt(2, () => d.complete(a.lane, a.request, { timeout: 100, maxRetries: 0 }));
          });
          assert.equal(calls, 2);
          assert.equal((await state()).entries.length, 2);
          const single = work("no-retry"),
            singleId = await seed([single]);
          await d.withWork(singleId, single.key, async () => {
            await d.withAttempt(1, () =>
              d.complete(single.lane, single.request, { timeout: 100, maxRetries: 0 }),
            );
            await assert.rejects(() => d.withAttempt(2, async () => null), /RETRY_NOT_ALLOWLISTED/);
          });
          await reset();
          const timeout = new FiniteInferenceDispatcher(
            store,
            async () => {
              throw Error("unknown-timeout");
            },
            async () => {},
          );
          const timed = work("same-unknown"),
            firstId = await seed([timed]);
          await assert.rejects(() => run(timeout, firstId, timed), /unknown-timeout/);
          const anotherId = await seed([timed]);
          await assert.rejects(() => run(d, anotherId, timed), /BOUND_ATTEMPT_COMPLETION_UNKNOWN/);
        },
      );
      await t.test(
        "new allowance preserves unrelated historical liabilities without adopting them as its budget",
        async () => {
          await reset();
          const legacy = new InferenceBudgetStore(pool, schema),
            prior = { ...emptyBudget(), unboundedPrior: ["historic-unknown"] };
          await legacy.mutate("controlled-existing-history", () => ({ state: prior, value: null }));
          const before = await legacy.mutate("inspect", (s) => ({ state: s, value: requestDigest(s) }));
          const w = work("new-scope"),
            id = await seed([w]);
          await run(dispatcher, id, w);
          assert.equal(
            await legacy.mutate("inspect", (s) => ({ state: s, value: requestDigest(s) })),
            before,
          );
          assert.equal((await state()).entries.length, 1);
          assert.notEqual(store.allocationId(), legacy.allocationId());
        },
      );
      await t.test(
        "delegated children share one cap and recheck parent revocation before reserved dispatch",
        async () => {
          await reset();
          const oldMode = process.env.NODE_ENV;
          process.env.NODE_ENV = "development";
          try {
            // The package admits a review by the template its prepared candidate names; the
            // dispatcher's binding check confirms that candidate before any reservation.
            const candidateId = randomUUID();
            const pkg = await prepareFiniteAllocationPackage(),
              packageId = allocationPackageId(pkg),
              expires = new Date(Date.now() + 3600000).toISOString();
            await pool.query(
              `INSERT INTO "${schema}".valo_inference_batches
          (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
          VALUES($1,$2,$3,$4,true,'controlled-owner-fixture','controlled-package-approval',now(),$5)`,
              [packageId, requestDigest(inferenceProposal), requestDigest(pkg), JSON.stringify(pkg), expires],
            );
            assert.equal(
              allocationPackageId((await readApprovedFiniteAllocationPackage(pool, packageId, schema)).pkg),
              packageId,
            );
            const pair = (suffix: string) =>
              [
                work(`package-f-${suffix}`, "publication", `package-pair-${suffix}`, "factual"),
                work(`package-c-${suffix}`, "publication", `package-pair-${suffix}`, "challenge"),
              ].map((w) => ({
                ...w,
                bindings: {
                  ...w.bindings,
                  candidateVersionId: candidateId,
                  corpus: null,
                  caseId: null,
                  operationalPlan: {
                    id: planId,
                    hash: requestDigest("controlled-plan"),
                    extension: "json" as const,
                  },
                  candidateArtifact: { ...candidateArtifact },
                },
              }));
            const first = pair("first"),
              manifest: FiniteManifest = {
                version: 2,
                preparedAt: new Date().toISOString(),
                policyVersion: inferenceProposal.priceVersion,
                allocation: { ...additionalInferenceAllocation },
                packageId,
                works: first,
              };
            const outside = pair("outside").map((w) => ({
              ...w,
              bindings: { ...w.bindings, candidateArtifact: { ...candidateArtifact, templateId: "TPL-999" } },
            }));
            await assert.rejects(
              () =>
                registerPreparedInferenceSubmanifest(
                  store,
                  { ...manifest, works: outside },
                  expires,
                  async () => {},
                ),
              /WORK_OUTSIDE_PACKAGE/,
            );
            const admitted = await registerPreparedInferenceSubmanifest(
              store,
              manifest,
              expires,
              async () => {},
            );
            await run(dispatcher, admitted.batchId, first[0]!);
            assert.equal(
              (await state()).entries.find((e) => e.runKey.endsWith(first[1]!.key))!.status,
              "reserved",
            );
            const second = pair("second"),
              secondManifest = { ...manifest, works: second };
            const admitted2 = await registerPreparedInferenceSubmanifest(
              store,
              secondManifest,
              expires,
              async () => {},
            );
            await run(dispatcher, admitted2.batchId, second[0]!);
            const shared = await state();
            assert.equal(shared.entries.length, 4);
            assert.ok(
              shared.entries.some((e) => e.runKey.startsWith(admitted.batchId)) &&
                shared.entries.some((e) => e.runKey.startsWith(admitted2.batchId)),
            );
            const before = sends;
            await pool.query(`UPDATE "${schema}".valo_inference_batches SET enabled=false WHERE id=$1`, [
              packageId,
            ]);
            await assert.rejects(
              () => run(dispatcher, admitted.batchId, first[1]!),
              /PACKAGE_NOT_AUTHORIZED/,
            );
            await assert.rejects(
              () => run(dispatcher, admitted2.batchId, second[1]!),
              /PACKAGE_NOT_AUTHORIZED/,
            );
            assert.equal(sends, before);
            await assert.rejects(
              () =>
                registerPreparedInferenceSubmanifest(
                  store,
                  { ...manifest, works: pair("third") },
                  expires,
                  async () => {},
                ),
              /PACKAGE_NOT_AUTHORIZED/,
            );
          } finally {
            if (oldMode === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = oldMode;
          }
        },
      );
      await t.test("a preflight failure before the first role reserves no paid capacity", async () => {
        await reset();
        const a = work("preflight-f", "publication", "preflight-pair", "factual"),
          b = work("preflight-c", "publication", "preflight-pair", "challenge");
        const id = await seed([a, b]),
          before = sends;
        await assert.rejects(
          () =>
            dispatcher.withPair(id, "preflight-pair", async () => {
              throw Error("controlled-caller-preflight");
            }),
          /preflight/,
        );
        assert.equal((await state()).entries.length, 0);
        assert.equal(sends, before);
      });
      await t.test(
        "SDK adapter observes dispatch after reservation for each correct lane and settles all under the same cap",
        async () => {
          await reset();
          let observed = 0,
            calls = 0;
          const lanes = new Set<string>();
          const d = new FiniteInferenceDispatcher(
            store,
            createManagedSDKTransport(async () => ({
              chat: {
                completions: {
                  create: async (request, options) => {
                    calls++;
                    assert.equal(options.maxRetries, 0);
                    const s = await state(),
                      admitted = s.entries.filter((e) => e.status === "dispatched");
                    assert.equal(admitted.length, 1);
                    assert.equal(observed, calls);
                    assert.equal(admitted[0]!.requestHash, requestDigest(request));
                    lanes.add(admitted[0]!.lane);
                    assert.ok(budgetUsed(s) <= 30000000000n);
                    return response();
                  },
                },
              },
            })),
            async () => {},
          );
          const works = [
            work("sdk-customer"),
            work("sdk-checker", "checker_challenge", null, "challenge"),
            ...(["publication", "editorial_evaluation"] as const).flatMap((l) => [
              work("sdk-" + l + "-f", l, "sdk-" + l, "factual"),
              work("sdk-" + l + "-c", l, "sdk-" + l, "challenge"),
            ]),
          ];
          const id = await seed(works);
          for (const w of works)
            await d.withWork(id, w.key, () =>
              d.complete(w.lane, w.request, {
                timeout: 100,
                maxRetries: 0,
                onOutbound: () => {
                  observed++;
                },
              }),
            );
          assert.equal(calls, 6);
          assert.equal(observed, 6);
          assert.equal(lanes.size, 4);
          assert.ok((await state()).entries.every((e) => e.status === "settled"));
        },
      );
      await t.test(
        "cross-corpus role relabeling and independent-review candidate substitution cannot reserve or dispatch",
        async () => {
          await reset();
          let calls = 0;
          const d = new FiniteInferenceDispatcher(
            store,
            async () => {
              calls++;
              return response();
            },
            async () => {},
          );
          const wrong = work("wrong-corpus", "checker_challenge", null, "challenge");
          wrong.bindings.corpus = "customer-ai";
          await assert.rejects(() => run(d, awaitableId, wrong), /NOT_AUTHORIZED/);
          const wrongId = await seed([wrong]);
          await assert.rejects(() => run(d, wrongId, wrong), /LANE_CORPUS_MISMATCH/);
          const a = work("same-pair-f", "publication", "same-pair", "factual"),
            b = work("same-pair-c", "publication", "same-pair", "challenge");
          b.candidateHash = requestDigest("different-candidate");
          const pairId = await seed([a, b]);
          await assert.rejects(() => run(d, pairId, a), /PAIR_BINDING_MISMATCH/);
          assert.equal(calls, 0);
          assert.equal((await state()).entries.length, 0);
        },
      );
      await t.test(
        "real SIGKILL after durable dispatch cannot redispatch on a new dispatcher and retains its full reservation",
        async () => {
          await reset();
          const w = work("interrupted-before-sdk"),
            id = await seed([w]);
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "src/scripts/inference-dispatch-crash-child.ts", schema, id, w.key],
            {
              cwd: process.cwd(),
              env: { ...process.env, NODE_ENV: "development" },
              stdio: ["ignore", "ignore", "pipe", "ipc"],
            },
          );
          const started = await Promise.race([
            once(child, "message"),
            once(child, "exit").then(() => {
              throw Error("CHILD_EXITED_BEFORE_ADMISSION");
            }),
          ]);
          assert.equal((started[0] as { stage: string }).stage, "admitted-before-sdk");
          const exit = once(child, "exit");
          child.kill("SIGKILL");
          const [, signal] = await exit;
          assert.equal(signal, "SIGKILL");
          assert.equal((await state()).entries[0]!.status, "dispatched");
          let calls = 0;
          const restarted = new FiniteInferenceDispatcher(
            store,
            async () => {
              calls++;
              return response();
            },
            async () => {},
          );
          await assert.rejects(() => run(restarted, id, w), /ALREADY_DISPATCHED_OR_UNKNOWN/);
          assert.equal(calls, 0);
          assert.equal(budgetUsed(await state()), tokenCost(400000, 8192));
        },
      );
      await t.test("unapproved priced model suspends the allocation before another work item", async () => {
        await reset();
        let calls = 0;
        const a = work("wrong-model"),
          b = work("after-wrong-model"),
          id = await seed([a, b]);
        const d = new FiniteInferenceDispatcher(
          store,
          async () => {
            calls++;
            return { ...response(), model: "different-priced-model" };
          },
          async () => {},
        );
        await assert.rejects(() => run(d, id, a), /RECEIPT_INVALID/);
        await assert.rejects(() => run(d, id, b), /UNRECONCILED/);
        assert.equal(calls, 1);
        assert.equal((await state()).suspended, true);
      });
      await t.test(
        "policy adoption keeps old usage and all unresolved liability instead of resetting history",
        async () => {
          const oldHash = requestDigest("previous-policy"),
            s = await state();
          await pool.query(`UPDATE "${schema}".valo_inference_budgets SET policy_hash=$2 WHERE id=$1`, [
            additionalInferenceAllocation.id,
            oldHash,
          ]);
          const result = await store.adoptPolicy(oldHash, "controlled-evidence-of-version-change");
          assert.equal(result.stateHash, requestDigest(s));
          assert.equal(result.enabled, false);
          assert.equal(result.ownerApproved, false);
        },
      );
      await t.test(
        "holds inside the new allocation and a depleted ceiling stop all further calls",
        async () => {
          const w = work("held"),
            id = await seed([w]),
            before = sends;
          await store.mutate("controlled-legacy-liability", (s) => ({
            state: { ...s, priorUseReconciled: false, unboundedPrior: ["controlled-unknown"] },
            value: null,
          }));
          await assert.rejects(() => run(dispatcher, id, w), /UNRECONCILED/);
          await store.mutate("controlled-depletion", () => ({
            state: {
              ...emptyBudget(),
              priorUseReconciled: true,
              entries: [
                {
                  runKey: "controlled-prior",
                  lane: "customer",
                  requestHash: requestDigest("prior"),
                  bindingHash: requestDigest("prior"),
                  scopeHash: requestDigest("prior"),
                  inputBound: 0,
                  outputBound: 0,
                  reserved: "29999999999",
                  charged: "29999999999",
                  status: "settled",
                  legacy: true,
                },
              ],
            },
            value: null,
          }));
          await assert.rejects(() => run(dispatcher, id, w), /ALLOCATION_EXHAUSTED/);
          assert.equal(sends, before);
        },
      );
      await t.test(
        "a customer attempt commits every ledger change as the scoped role, through the functions only",
        async () => {
          await reset();
          // The scoped role reaches this schema as it reaches public: it reads and locks the
          // batches and calls the ledger functions, which allow it only customer changes.
          await pool.query(`GRANT USAGE ON SCHEMA "${schema}" TO valo_workspace_scope`);
          await pool.query(
            `GRANT SELECT, UPDATE ON "${schema}".valo_inference_batches TO valo_workspace_scope`,
          );
          await pool.query(
            `GRANT EXECUTE ON FUNCTION "${schema}".valo_inference_budget_lock(text,text),
            "${schema}".valo_inference_budget_commit(text,integer,jsonb,text,text,text),
            "${schema}".valo_inference_batch_record_result(text,text,jsonb,text) TO valo_workspace_scope`,
          );
          const w = work("scoped-customer"),
            id = await seed([w]),
            before = sends;
          const result = await runInWorkspaceScope(randomUUID(), () => run(dispatcher, id, w));
          assert.equal(result.usage?.total_tokens, 160);
          assert.equal(sends, before + 1);
          const entry = (await state()).entries.find((e) => e.runKey === `${id}:${w.key}`);
          assert.equal(entry?.status, "settled");
          const recorded = await pool.query(
            `SELECT results->$2 AS result FROM "${schema}".valo_inference_batches WHERE id=$1`,
            [id, w.key],
          );
          assert.equal(recorded.rows[0].result.id, result.id);
          await assert.rejects(
            runInWorkspaceScope(randomUUID(), () =>
              pool.query(`UPDATE "${schema}".valo_inference_budgets SET version = version`),
            ),
            /permission denied/,
          );
        },
      );
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
const awaitableId = "nonexistent-controlled-batch";
