import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { PgDialect, pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import {
  additionalInferenceAllocation,
  emptyBudget,
  inferenceProposal,
  requestDigest,
  validateBudgetState,
  type BudgetState,
} from "../modules/ai/inference-budget";
import type { FiniteManifest, FiniteWork } from "../modules/ai/inference-batch-dispatch";
import type { ManagedCompletionResult, ManagedRequest } from "../modules/ai/managed-inference";
import { workspaceActorFromRecord } from "../platform/workspace-context";

type Batch = {
  id: string;
  enabled: boolean;
  approved_by: string;
  approval_reference: string;
  approved_at: string;
  expires_at: string;
  policy_hash: string;
  manifest_hash: string;
  manifest: FiniteManifest;
  results: Record<string, ManagedCompletionResult>;
};
type SQLClient = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

test("default managed entry and customer organizer use actual finite dispatch and real corpus bindings", async (t) => {
  await t.test("finite CLI help and invalid modes need neither database nor SDK configuration", () => {
    for (const args of [["--help"], ["--enable"], []]) {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          fileURLToPath(new URL("../scripts/finite-inference-run.ts", import.meta.url)),
          ...args,
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "development",
            DATABASE_URL: "",
            AI_INTEGRATIONS_OPENAI_API_KEY: "",
            AI_INTEGRATIONS_OPENAI_BASE_URL: "",
          },
        },
      );
      if (args[0] === "--help") {
        assert.equal(result.status, 0, result.stderr);
        const help = JSON.parse(result.stdout);
        assert.equal(help.inferenceCalls, 0);
        assert.equal(help.ownerApprovalCreated, false);
        assert.equal(help.authorizesDispatch, false);
        assert.ok(help.commands.includes("--execute"));
      } else {
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /FINITE_RUN_ARGUMENTS_INVALID/);
        assert.equal(result.stdout, "");
      }
    }
  });
  await t.test("disabled default entry imports neither database configuration nor SDK", () => {
    const url = new URL("../modules/ai/managed-inference.ts", import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
      const {managedCompletion}=await import(${JSON.stringify(url)});
      await assert.rejects(()=>managedCompletion('customer',{model:'gpt-5.4-mini',max_completion_tokens:8192,
        messages:[{role:'user',content:'synthetic'}]},{timeout:1000,maxRetries:0}),/INFERENCE_BUDGET_DISABLED/);
      console.log('DISABLED_WITHOUT_DATABASE_OR_SDK');`;
    const result = spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "development",
          DATABASE_URL: "",
          AI_INTEGRATIONS_OPENAI_API_KEY: "",
          OPENAI_API_KEY: "",
        },
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DISABLED_WITHOUT_DATABASE_OR_SDK/);
  });

  await t.test(
    "without an operator command's binding checks the default entry holds before any database or SDK",
    () => {
      // The operator commands hand the dispatcher its checks (provideFiniteWorkBindings); a
      // process that did not is refused before anything loads.
      const url = new URL("../modules/ai/managed-inference.ts", import.meta.url).href;
      const code = `import assert from 'node:assert/strict';
      const {withApprovedInferenceWork,withApprovedInferencePair}=await import(${JSON.stringify(url)});
      await assert.rejects(()=>withApprovedInferenceWork('unused','unused',async()=>null),/INFERENCE_WORK_BINDINGS_UNAVAILABLE/);
      await assert.rejects(()=>withApprovedInferencePair('unused','unused',async()=>null),/INFERENCE_WORK_BINDINGS_UNAVAILABLE/);
      console.log('HELD_WITHOUT_BINDING_CHECKS');`;
      const result = spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
        {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "development",
            DATABASE_URL: "",
            AI_INTEGRATIONS_OPENAI_API_KEY: "",
            OPENAI_API_KEY: "",
          },
          timeout: 15000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /HELD_WITHOUT_BINDING_CHECKS/);
    },
  );

  await t.test("all nonempty deployment markers block before database or SDK initialization", () => {
    for (const [marker, value] of [
      ["REPLIT_DEPLOYMENT_ID", "0"],
      ["REPLIT_DEPLOYMENT_REGION", "false"],
      ["REPLIT_DEPLOYMENT_FUTURE_MARKER", " "],
    ]) {
      const managed = new URL("../modules/ai/managed-inference.ts", import.meta.url).href;
      const allocation = new URL("../modules/ai/inference-allocation-package.ts", import.meta.url).href;
      const code = `import assert from 'node:assert/strict';
        const {withApprovedInferenceWork}=await import(${JSON.stringify(managed)});
        await assert.rejects(()=>withApprovedInferenceWork('unused','unused',async()=>null),/INFERENCE_DEVELOPMENT_ONLY/);
        const {registerPreparedInferenceSubmanifest,readApprovedFiniteAllocationPackage}=await import(${JSON.stringify(allocation)});
        const blocked=new Proxy({}, {get(){throw Error('UNEXPECTED_DATABASE_OR_LEDGER_EFFECT')}});
        await assert.rejects(()=>registerPreparedInferenceSubmanifest(blocked,{},'unused',async()=>{}),{code:'DEVELOPMENT_RUNTIME_REQUIRED'});
        await assert.rejects(()=>readApprovedFiniteAllocationPackage(blocked,'unused'),{code:'DEVELOPMENT_RUNTIME_REQUIRED'});
        console.log('DEPLOYMENT_MARKER_ZERO_EFFECTS');`;
      const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: "" };
      for (const key of Object.keys(env))
        if (key === "REPLIT_DEPLOYMENT" || key.startsWith("REPLIT_DEPLOYMENT_"))
          delete (env as Record<string, string | undefined>)[key];
      const result = spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
        {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          encoding: "utf8",
          env: { ...env, [marker!]: value },
          timeout: 15000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /DEPLOYMENT_MARKER_ZERO_EFFECTS/);
    }
  });

  // Only the database ledger adapter and SDK transport are controlled. The
  // real managed entry point, dispatcher, binding verifier, corpus file,
  // request constructor, schema validation and draft builder execute below.
  const batches = new Map<string, Batch>();
  let state: BudgetState = { ...emptyBudget(), priorUseReconciled: true };
  let tail = Promise.resolve(),
    sdkCalls = 0,
    unexpectedNetwork = 0;
  const received: ManagedRequest[] = [];
  const responses: string[] = [];
  class MemoryBudgetStore {
    // oxlint-disable-next-line eslint/no-useless-constructor -- accepts the arguments the real store's constructor takes
    constructor(..._args: unknown[]) {}
    schemaName() {
      return "public";
    }
    allocationId() {
      return additionalInferenceAllocation.id;
    }
    // Like the real store's read: no allocation lock, and nothing it reads is kept.
    async read<T>(fn: (c: SQLClient) => Promise<T>) {
      const copies = new Map([...batches].map(([key, value]) => [key, structuredClone(value)]));
      return fn({
        query: async (sql, values = []) => {
          if (sql.startsWith('SELECT * FROM "public".valo_inference_batches')) {
            const row = copies.get(String(values[0]));
            return { rows: row ? [row] : [] };
          }
          throw Error("UNEXPECTED_TEST_SQL");
        },
      });
    }
    async mutate<T>(
      _action: string,
      fn: (
        s: BudgetState,
        c: SQLClient,
      ) => Promise<{ state: BudgetState; value: T }> | { state: BudgetState; value: T },
    ) {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const copies = new Map([...batches].map(([key, value]) => [key, structuredClone(value)]));
      const client: SQLClient = {
        query: async (sql, values = []) => {
          if (sql.startsWith('SELECT * FROM "public".valo_inference_batches')) {
            const row = copies.get(String(values[0]));
            return { rows: row ? [row] : [] };
          }
          if (sql.startsWith('SELECT "public".valo_inference_batch_record_result(')) {
            const row = copies.get(String(values[0]));
            assert.ok(row);
            row.results[String(values[1])] = JSON.parse(String(values[2]));
            return { rows: [{ saved: true }], rowCount: 1 };
          }
          throw Error("UNEXPECTED_TEST_SQL");
        },
      };
      try {
        const next = await fn(structuredClone(state), client);
        validateBudgetState(next.state);
        state = next.state;
        batches.clear();
        for (const [key, value] of copies) batches.set(key, value);
        return next.value;
      } finally {
        release();
      }
    }
  }
  const originalEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    deployment: process.env.REPLIT_DEPLOYMENT,
    enabled: process.env.VALO_CUSTOMER_AI_ENABLED,
  };
  process.env.NODE_ENV = "development";
  delete process.env.REPLIT_DEPLOYMENT;
  delete process.env.VALO_CUSTOMER_AI_ENABLED;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    unexpectedNetwork++;
    throw Error("NETWORK_DISABLED_DURING_ENTRY_TEST");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["NODE_ENV", originalEnvironment.nodeEnv],
      ["REPLIT_DEPLOYMENT", originalEnvironment.deployment],
      ["VALO_CUSTOMER_AI_ENABLED", originalEnvironment.enabled],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  const actor = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    anchorDraftId: "22222222-2222-4222-8222-222222222222",
    identityId: "valo-ai-eval-invoice-controlled",
  };
  const artifacts = new Map<string, Buffer>(),
    customerRows: any[] = [];
  const drafts = pgTable("valo_ai_drafts", {
    id: uuid(),
    workspaceId: uuid("workspace_id"),
    idempotencyKey: uuid("idempotency_key"),
    budgetReserved: boolean("budget_reserved"),
    createdAt: timestamp("created_at"),
  });
  const switches = pgTable("valo_safety_switches", { key: text() });
  const dialect = new PgDialect();
  const match = (row: any, where: SQL) =>
    dialect
      .sqlToQuery(where)
      .params.every((p) => p === row.workspaceId || p === row.idempotencyKey || p === row.id);
  const tx = {
    execute: async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      // The AI limits' totals across workspaces; every reservation here is this workspace's.
      if (text.includes("valo_customer_ai_reservations")) {
        const reserved = customerRows.filter((r) => r.budgetReserved).length;
        return { rows: [{ global_today: reserved, identity_last_minute: reserved }] };
      }
      // The drafting allowances, the owner's commercial settings (docs/architecture/commercial-settings.md,
      // slice 3): none is recorded here, so each reads its default.
      if (/^select public\.valo_commercial_setting\(\$1\) as value$/.test(text))
        return { rows: [{ value: null }] };
      assert.match(text, /pg_advisory_xact_lock/);
      return { rows: [] };
    },
    select: (selection?: unknown) => ({
      from: (table: unknown) => ({
        where: (where: SQL) => {
          const rows =
            table === switches
              ? []
              : selection
                ? [{ n: customerRows.filter((r) => r.budgetReserved).length }]
                : customerRows.filter((r) => match(r, where));
          return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          const row = {
            ...values,
            providerInputHash: null,
            providerCalls: 0,
            acceptedDocumentId: null,
            createdAt: new Date(),
          };
          customerRows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: (where: SQL) => ({
          returning: async () => {
            const row = customerRows.find((r) => match(r, where));
            assert.ok(row);
            Object.assign(row, values);
            return [row];
          },
        }),
      }),
    }),
  };
  t.mock.module(new URL("../modules/rules/valo-assessments.ts", import.meta.url).href, {
    namedExports: {
      workspaceTransaction: async (current: unknown, fn: (t: typeof tx) => Promise<unknown>) => {
        assert.deepEqual(current, { workspaceId: actor.workspaceId, identityId: actor.identityId });
        return fn(tx);
      },
      workspaceReadTransaction: async (current: unknown, fn: (t: typeof tx) => Promise<unknown>) => {
        assert.deepEqual(current, { workspaceId: actor.workspaceId, identityId: actor.identityId });
        return fn(tx);
      },
      workspaceEvent: async () => undefined,
    },
  });
  // The document functions come through the documents module's index.
  t.mock.module(new URL("../modules/documents/index.ts", import.meta.url).href, {
    namedExports: {
      createDocumentInTransaction: async () => {
        throw Error("ACCEPTANCE_NOT_AUTHORIZED_IN_TEST");
      },
      getDocument: async () => {
        throw Error("DOCUMENT_READ_NOT_EXPECTED");
      },
    },
  });
  // The entry's AI safety pause check (valo-source-state.ts) runs in its own short
  // transaction: the shared source-state lock, then the all_ai switch.
  let aiPaused = false,
    safetyChecks = 0;
  const safetyTx = {
    execute: async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (text === "select pg_advisory_xact_lock_shared(7502601)") return { rows: [] };
      if (text.startsWith("select key from valo_safety_switches")) {
        assert.deepEqual(params, ["all_ai"]);
        safetyChecks++;
        return { rows: aiPaused ? [{ key: "all_ai" }] : [] };
      }
      throw Error("UNEXPECTED_SAFETY_SQL");
    },
  };
  t.mock.module("@workspace/db", {
    namedExports: {
      valoAIDrafts: drafts,
      valoSafetySwitches: switches,
      db: { transaction: async <T>(fn: (t: typeof safetyTx) => Promise<T>) => fn(safetyTx) },
      pool: {
        connect: () => {
          throw Error("UNEXPECTED_REAL_LEDGER_CONNECTION");
        },
        query: async (text: string) => {
          if (text.startsWith("select d.id")) return { rows: [{ id: actor.anchorDraftId }] };
          if (text.startsWith("select enabled")) return { rows: [] };
          if (text.startsWith("select id,workspace_id"))
            return {
              rows: customerRows.map((r) => ({
                id: r.id,
                workspace_id: r.workspaceId,
                idempotency_key: r.idempotencyKey,
                input_hash: r.inputHash,
                provider_input_hash: r.providerInputHash,
                prompt_version: r.promptVersion,
                provider_runs: r.providerRuns,
                status: r.status,
                created_at: r.createdAt,
              })),
            };
          throw Error("UNEXPECTED_CUSTOMER_READ_SQL");
        },
      },
    },
  });
  t.mock.module(new URL("../modules/publication/publication-artifacts.ts", import.meta.url).href, {
    namedExports: {
      getPublicationArtifact: async (ref: { id: string; hash: string }) => {
        const bytes = artifacts.get(ref.id);
        assert.ok(bytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.hash);
        return bytes;
      },
    },
  });
  t.mock.module(new URL("../modules/ai/inference-budget-store.ts", import.meta.url).href, {
    namedExports: { InferenceBudgetStore: MemoryBudgetStore },
  });
  t.mock.module("@workspace/integrations-openai-ai-server", {
    namedExports: {
      openai: {
        chat: {
          completions: {
            create: async (request: ManagedRequest, options: { timeout: number; maxRetries: number }) => {
              sdkCalls++;
              received.push(structuredClone(request));
              assert.equal(options.maxRetries, 0);
              assert.ok(options.timeout > 0 && options.timeout <= 45000);
              const content = responses.shift();
              assert.notEqual(content, undefined, "Test response must be explicitly supplied");
              return {
                id: `controlled-default-sdk-${sdkCalls}`,
                model: "gpt-5.4-mini-2026-03-17",
                created: Math.floor(Date.now() / 1000),
                choices: [{ finish_reason: "stop", message: { content: content! } }],
                usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
              } satisfies ManagedCompletionResult;
            },
          },
        },
      },
    },
  });
  const {
    managedCompletion,
    withApprovedInferenceWork,
    withBoundInferenceDispatcher,
    provideFiniteWorkBindings,
  } = await import("../modules/ai/managed-inference");
  // As the operator commands do, the test composes the default dispatcher with the real checks.
  const { assertFiniteWorkBindings } = await import("../modules/ai-lanes/inference-work-bindings");
  provideFiniteWorkBindings(assertFiniteWorkBindings);
  const { organizeCustomerDraft } = await import("../modules/ai-lanes/valo-customer-ai-model");
  const { prepareCustomerEvaluationPlan, prepareCustomerEvaluationManifest } =
    await import("../modules/ai-lanes/inference-customer-evaluation");
  const plan = await prepareCustomerEvaluationPlan(actor, new Date(Date.now() - 10000));
  const entry = plan.cases.find((c) => c.caseId === "CAI-CAND-INV-01")!,
    input = entry.input!,
    request = entry.request!;
  let batchNumber = 0;
  function prepare(options: { retry?: boolean; modify?: (work: FiniteWork) => void } = {}) {
    const id = `controlled-entry-${++batchNumber}`,
      bytes = Buffer.from(JSON.stringify(plan));
    const artifact = {
      id: randomUUID(),
      hash: createHash("sha256").update(bytes).digest("hex"),
      extension: "json" as const,
    };
    artifacts.set(artifact.id, bytes);
    const manifest = prepareCustomerEvaluationManifest(
      plan,
      artifact,
      entry.caseId,
      "finite-package:" + "a".repeat(64),
    );
    delete manifest.packageId;
    if (!options.retry) manifest.works = manifest.works.slice(0, 1);
    const key = manifest.works[0]!.key,
      retryKey = manifest.works[1]?.key;
    options.modify?.(manifest.works[0]!);
    batches.set(id, {
      id,
      manifest,
      manifest_hash: requestDigest(manifest),
      policy_hash: requestDigest(inferenceProposal),
      enabled: true,
      approved_by: "synthetic-test-only",
      approval_reference: "controlled-node-test-not-owner-approval",
      approved_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      results: {},
    });
    return { id, key, retryKey };
  }
  await t.test("approved context reaches the actual default entry and settles the exact work", async () => {
    const batch = prepare(),
      before = sdkCalls;
    responses.push(JSON.stringify({ opening: "none", sections: [] }));
    let outbound = 0;
    const result = await withApprovedInferenceWork(batch.id, batch.key, () =>
      managedCompletion("customer", request, {
        timeout: 18000,
        maxRetries: 0,
        onOutbound: () => {
          outbound++;
        },
      }),
    );
    assert.equal(sdkCalls - before, 1);
    assert.equal(outbound, 1);
    assert.equal(result.model, "gpt-5.4-mini-2026-03-17");
    assert.equal(state.entries.find((e) => e.runKey === `${batch.id}:${batch.key}`)?.status, "settled");
    assert.deepEqual(received.at(-1), request);
    assert.equal(inferenceProposal.enabled, false);
  });
  await t.test("a committed AI pause refuses before reservation and makes zero SDK calls", async () => {
    const batch = prepare(),
      before = sdkCalls,
      checks = safetyChecks;
    aiPaused = true;
    try {
      await assert.rejects(
        withApprovedInferenceWork(batch.id, batch.key, () =>
          managedCompletion("customer", request, { timeout: 18000, maxRetries: 0 }),
        ),
        { status: 503, message: /AI assistance is temporarily paused/ },
      );
    } finally {
      aiPaused = false;
    }
    assert.equal(safetyChecks - checks, 1);
    assert.equal(sdkCalls, before);
    assert.equal(
      state.entries.some((e) => e.runKey === `${batch.id}:${batch.key}`),
      false,
      "a paused call reserves no budget",
    );
  });
  await t.test(
    "request, actual source hash and actual case binding mismatches make zero SDK calls",
    async () => {
      const before = sdkCalls;
      const altered = prepare();
      await assert.rejects(
        () =>
          withApprovedInferenceWork(altered.id, altered.key, () =>
            managedCompletion(
              "customer",
              { ...request, messages: [{ role: "user", content: "altered request" }] },
              { timeout: 18000, maxRetries: 0 },
            ),
          ),
        /WORK_REQUEST_MISMATCH/,
      );
      const badSource = prepare({
        modify: (w) => {
          w.bindings.sourceFiles[0]!.sha256 = "d".repeat(64);
        },
      });
      await assert.rejects(
        () => withApprovedInferenceWork(badSource.id, badSource.key, () => Promise.resolve()),
        /SOURCE_BINDING_CHANGED/,
      );
      const badCase = prepare({
        modify: (w) => {
          w.caseHash = "e".repeat(64);
          w.candidateHash = w.caseHash;
        },
      });
      await assert.rejects(
        () => withApprovedInferenceWork(badCase.id, badCase.key, () => Promise.resolve()),
        /CASE_BINDING_CHANGED/,
      );
      assert.equal(sdkCalls, before);
    },
  );
  await t.test(
    "actual default customer organizer uses two separately approved attempts after invalid schema",
    async () => {
      const batch = prepare({ retry: true }),
        before = sdkCalls;
      responses.push("{}", JSON.stringify({ opening: "none", sections: [] }));
      await assert.rejects(
        () =>
          withApprovedInferenceWork(batch.id, batch.retryKey!, () =>
            managedCompletion("customer", request, { timeout: 18000, maxRetries: 0 }),
          ),
        /RETRY_REQUIRES_PRIMARY_CONTEXT/,
      );
      assert.equal(sdkCalls, before);
      const result = await withApprovedInferenceWork(batch.id, batch.key, () => organizeCustomerDraft(input));
      assert.equal(sdkCalls - before, 2);
      assert.equal(result.failureCode, null);
      assert.ok(result.plan);
      assert.deepEqual(
        result.runs.map((r) => r.outcome),
        ["invalid_structured_plan", "validated"],
      );
      assert.deepEqual(
        result.runs.map((r) => r.outboundAttempted),
        [true, true],
      );
      const entries = state.entries.filter((e) => e.runKey.startsWith(`${batch.id}:`));
      assert.equal(entries.length, 2);
      assert.equal(new Set(entries.map((e) => e.runKey)).size, 2);
      assert.ok(entries.every((e) => e.status === "settled"));
      assert.notEqual(entries[0]!.responseId, entries[1]!.responseId);
    },
  );
  await t.test(
    "actual default customer organizer stops after one invalid response without a retry grant",
    async () => {
      const batch = prepare(),
        before = sdkCalls;
      responses.push("{}");
      const result = await withApprovedInferenceWork(batch.id, batch.key, () => organizeCustomerDraft(input));
      assert.equal(sdkCalls - before, 1);
      assert.equal(result.plan, null);
      assert.equal(result.failureCode, "AI_MANAGED_BUDGET_HELD");
      assert.deepEqual(
        result.runs.map((r) => r.outcome),
        ["invalid_structured_plan", "budget_held"],
      );
      assert.deepEqual(
        result.runs.map((r) => r.outboundAttempted),
        [true, false],
      );
      assert.equal(state.entries.filter((e) => e.runKey.startsWith(`${batch.id}:`)).length, 1);
    },
  );
  const { FiniteInferenceDispatcher } = await import("../modules/ai/inference-batch-dispatch");
  const { createManagedSDKTransport } = await import("../modules/ai/managed-sdk-transport");
  for (const boundary of ["suspension", "unreconciled", "revocation", "expiry", "manifest-change"] as const) {
    await t.test(`actual entry rechecks ${boundary} after lazy SDK load, before outbound`, async () => {
      state = { ...emptyBudget(), priorUseReconciled: true };
      const batch = prepare();
      let release!: () => void,
        entered!: () => void,
        creates = 0,
        outbound = 0;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const loading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const transport = createManagedSDKTransport(async () => {
        entered();
        await gate;
        return {
          chat: {
            completions: {
              create: async () => {
                creates++;
                throw Error("SDK_MUST_NOT_EXECUTE");
              },
            },
          },
        };
      });
      const composed = new FiniteInferenceDispatcher(
        new MemoryBudgetStore() as unknown as import("../modules/ai/inference-budget-store").InferenceBudgetStore,
        transport,
        assertFiniteWorkBindings,
      );
      const pending = withBoundInferenceDispatcher(composed, () =>
        withApprovedInferenceWork(batch.id, batch.key, () =>
          managedCompletion("customer", request, {
            timeout: 18000,
            maxRetries: 0,
            onOutbound: () => {
              outbound++;
            },
          }),
        ),
      );
      const rejection = assert.rejects(
        pending,
        /PRIOR_CHARGES_UNRECONCILED|INFERENCE_BATCH_NOT_AUTHORIZED|INFERENCE_BATCH_EXPIRED|INFERENCE_MANIFEST_CHANGED/,
      );
      await loading;
      const row = batches.get(batch.id)!;
      if (boundary === "suspension") state.suspended = true;
      if (boundary === "unreconciled") state.unboundedPrior.push("controlled-unreconciled-liability");
      if (boundary === "revocation") row.enabled = false;
      if (boundary === "expiry") row.expires_at = new Date(Date.now() - 1).toISOString();
      if (boundary === "manifest-change") {
        row.manifest.works[0]!.caseHash = "f".repeat(64);
        row.manifest_hash = requestDigest(row.manifest);
      }
      release();
      await rejection;
      assert.equal(creates, 0);
      assert.equal(outbound, 0);
      const entry = state.entries.find((e) => e.runKey === `${batch.id}:${batch.key}`);
      assert.ok(entry);
      assert.notEqual(entry.status, "settled");
    });
  }
  await t.test("actual SDK receives the approved snapshot despite caller mutation during load", async () => {
    state = { ...emptyBudget(), priorUseReconciled: true };
    const batch = prepare(),
      callerRequest = structuredClone(request);
    let release!: () => void,
      entered!: () => void,
      creates = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const transport = createManagedSDKTransport(async () => {
      entered();
      await gate;
      return {
        chat: {
          completions: {
            create: async (sent) => {
              creates++;
              assert.deepEqual(sent, request);
              return {
                id: "controlled-frozen-input",
                model: "gpt-5.4-mini-2026-03-17",
                created: 0,
                choices: [{ finish_reason: "stop", message: { content: "{}" } }],
                usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
              };
            },
          },
        },
      };
    });
    const composed = new FiniteInferenceDispatcher(
      new MemoryBudgetStore() as unknown as import("../modules/ai/inference-budget-store").InferenceBudgetStore,
      transport,
      assertFiniteWorkBindings,
    );
    const pending = withBoundInferenceDispatcher(composed, () =>
      withApprovedInferenceWork(batch.id, batch.key, () =>
        managedCompletion("customer", callerRequest, { timeout: 18000, maxRetries: 0 }),
      ),
    );
    await loading;
    callerRequest.model = "unapproved-model";
    release();
    await pending;
    assert.equal(creates, 1);
    assert.equal(state.entries.find((e) => e.runKey === `${batch.id}:${batch.key}`)?.status, "settled");
  });
  await t.test(
    "prepared evaluation invokes the actual customer service and organizer, then replays without another paid attempt",
    async () => {
      const { createCustomerAIDraft, customerAIUsage } = await import("../modules/ai-lanes/valo-customer-ai");
      const { executePreparedCustomerCase, assertCustomerEvaluationActor } =
        await import("../modules/ai-lanes/inference-customer-runtime");
      const batch = prepare({ retry: true }),
        manifest = batches.get(batch.id)!.manifest;
      const workspaceActor = workspaceActorFromRecord({
        workspaceId: actor.workspaceId,
        identityId: actor.identityId,
      });
      const deps = {
        recheck: () => assertCustomerEvaluationActor(plan, entry),
        withWork: withApprovedInferenceWork,
        usage: () => customerAIUsage(workspaceActor),
        recentRequests: async () => customerRows.length,
        create: async (current: typeof input) => {
          let newProviderAttempts: number | null = 0;
          const preview = await createCustomerAIDraft(workspaceActor, current, async (value) => {
            newProviderAttempts = null;
            const result = await organizeCustomerDraft(value);
            newProviderAttempts = result.runs.filter((r) => r.outboundAttempted).length;
            return result;
          });
          return { preview, newProviderAttempts };
        },
        stored: async (id: string) => {
          const row = customerRows.find((r) => r.id === id);
          assert.ok(row);
          return row;
        },
      };
      const before = sdkCalls;
      responses.push(JSON.stringify({ opening: "none", sections: [] }));
      const first = await executePreparedCustomerCase(batch.id, manifest, plan, deps);
      assert.equal(sdkCalls - before, 1);
      assert.equal(first.actualNewProviderAttempts, 1);
      assert.equal(first.factsPreserved, true);
      assert.equal(first.status, "partial_provider_evidence");
      assert.equal(first.providerQualityAccepted, false);
      assert.equal(first.formalAcceptance, false);
      assert.equal(customerRows.length, 1);
      assert.equal(customerRows[0].status, "ready");
      const replay = await executePreparedCustomerCase(batch.id, manifest, plan, deps);
      assert.equal(replay.previewId, first.previewId);
      assert.equal(replay.actualNewProviderAttempts, 0);
      assert.equal(sdkCalls - before, 1);
      assert.equal(customerRows.length, 1);
    },
  );
  assert.equal(unexpectedNetwork, 0);
  assert.equal(responses.length, 0);
});
