import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  valoPrices,
  valoOrders,
  valoEntitlements,
  valoRefundRequests,
  valoRefundTransitions,
  valoPurchaseOutbox,
  valoPaymentDisputes,
  valoMemberships,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoPaymentReconciliations,
  valoPaymentEvents,
  valoPaymentEventSettlements,
  valoDocumentRevisions,
  valoDocuments,
} from "@workspace/db";
import { createDocument } from "../documents";
import { resolveWorkspace } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import { syntheticDocument } from "../../lib/valo-test-fixtures";
import {
  requestOrderRefund,
  decideRefund,
  processRefund,
  financeRefunds,
  type FinanceActor,
} from "./valo-refunds";
import { assertRefundMatch, refundBalance, type RefundProvider } from "./valo-refund-provider";
import { storeVerifiedDispute } from "./valo-payment-disputes";
import { purchases } from "./valo-commerce";
import { financePaymentChecks, settlePaymentCheck } from "./valo-payment-reconciliation";
import { financePaymentEvents, settlePaymentEvent } from "./valo-payment-event-review";
import { endedEditionOrders } from "./checkout-editions";
import { readinessQueries } from "../operations/valo-operations";
import { financeHeldFixture } from "./valo-finance-test-fixture";
import { priceOrderTerms } from "./checkout-editions";
import { singleRow } from "../../platform/rows";
import { quotaSubjectHash } from "../../lib/valo-quota";

test(
  "refund lifecycle: actual development PostgreSQL and controlled provider, not a real refund",
  { timeout: 90000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY), false);
    process.env.VALO_RUN_REFUND_TESTS = "synthetic-development-only";
    const a = await resolveWorkspace(`synthetic-refund-${randomUUID()}`),
      b = await resolveWorkspace(`synthetic-refund-${randomUUID()}`);
    const staff: FinanceActor = {
      identityId: `synthetic-finance-${randomUUID()}`,
      recentMfa: true,
      verifiedAt: Date.now(),
    };
    const role = randomUUID(),
      supportRole = randomUUID(),
      contentRole = randomUUID(),
      contentOnly = `synthetic-refund-content-${randomUUID()}`,
      priceId = randomUUID(),
      ids = [a.workspaceId, b.workspaceId];
    const held = await financeHeldFixture();
    // The price says what each order's line said before: an order is made with its price's own line.
    const price = singleRow(
      await db
        .insert(valoPrices)
        .values({
          id: priceId,
          contentVersionId: held.id,
          title: "Controlled order",
          amountKobo: 10000,
          licenceVersion: "synthetic-only",
          licenceText: "Not approved commercial terms.",
          taxTreatment: "No tax assertion.",
          approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
          effectiveFrom: new Date(),
        })
        .returning(),
    );
    await db.insert(valoStaffAssignments).values({
      id: role,
      identityId: staff.identityId,
      role: "finance",
      grantedBy: "synthetic-fixture",
      reason: "Controlled isolated test role; not an actual staff grant.",
    });
    await db.insert(valoStaffAssignments).values({
      id: supportRole,
      identityId: b.identityId,
      role: "support",
      grantedBy: "synthetic-fixture",
      reason: "Controlled support-only role must not authorize refunds.",
    });
    // ADM-001: content staff cannot change payments either.
    await db.insert(valoStaffAssignments).values({
      id: contentRole,
      identityId: contentOnly,
      role: "content",
      grantedBy: "synthetic-fixture",
      reason: "Controlled content-only role must not decide refunds.",
    });
    const draft = await createDocument(a, {
      ...syntheticDocument,
      title: "Private draft must survive all refund outcomes",
    });
    const map = new Map<string, Record<string, unknown>>();
    let creates = 0,
      idCounter = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
    const adapter: RefundProvider = {
      configured: () => true,
      async find(ref) {
        return map.get(ref) ?? null;
      },
      async create(input) {
        creates++;
        const data = {
          id: String(++idCounter),
          reference: input.reference,
          domain: "test",
          amount: input.amount,
          currency: input.currency,
          transaction: input.transaction,
          status: "pending",
        };
        map.set(input.reference, data);
        return data;
      },
    };
    async function fixture(actor = a) {
      const id = randomUUID();
      await db.insert(valoOrders).values({
        id,
        workspaceId: actor.workspaceId,
        requestedBy: actor.identityId,
        reference: `valo-test-${id}`,
        requestKey: randomUUID(),
        ...priceOrderTerms(price),
        status: "verified_success",
        providerTransactionId: String(++idCounter),
      });
      await db
        .insert(valoEntitlements)
        .values({ id: randomUUID(), workspaceId: actor.workspaceId, orderId: id, contentVersionId: held.id });
      return id;
    }
    const payload = (amountKobo: number) => ({
      reason: "Controlled synthetic refund request",
      amountKobo,
      requestKey: randomUUID(),
      acceptedPolicyVersion: "test-refund-v1",
    });
    const decision = (expectedVersion = 1) => ({
      decision: "approve",
      reason: "Controlled finance approval for synthetic test only",
      expectedVersion,
    });
    async function row(id: string) {
      return (await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.id, id)))[0];
    }
    async function due(id: string) {
      await db.update(valoRefundRequests).set({ nextAttemptAt: null }).where(eq(valoRefundRequests.id, id));
    }
    async function approved(order: string, amount: number) {
      const r = await requestOrderRefund(a, order, payload(amount));
      await decideRefund(staff, r.reference, decision());
      return r.reference;
    }
    async function blockedWrite(run: () => Promise<unknown>, revoke: () => Promise<unknown>, id: string) {
      const lock = await pool.connect();
      let work: Promise<unknown> | undefined;
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT id FROM valo_orders WHERE id=$1 FOR UPDATE", [id]);
        work = run();
        // The write's outcome is caught as soon as it starts. Once this lock is released, PostgreSQL may
        // finish the waiting write, and its refusal reach the test, before the reply to this COMMIT does: a
        // rejection with no handler yet would fail the test whatever its outcome.
        let settled = false;
        const outcome = work
          .then(
            () => ({ error: undefined as unknown }),
            (error: unknown) => ({ error }),
          )
          .finally(() => {
            settled = true;
          });
        let observed = false;
        for (let n = 0; n < 80; n++) {
          const r = await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%valo_orders%' LIMIT 1",
          );
          if (r.rowCount) {
            observed = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        assert.ok(observed, "observed blocked resource write before revocation");
        await revoke();
        assert.equal(settled, false, "the write still waits on the order when the revocation commits");
        await lock.query("COMMIT");
        const { error } = await outcome;
        assert.equal((error as { status?: number } | undefined)?.status, 403, String(error));
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        if (work) await work.catch(() => {});
      }
    }
    try {
      await t.test(
        "strict amounts, tenant isolation, idempotent retries and changed-key conflicts",
        async () => {
          const order = await fixture(),
            p = payload(3000);
          await assert.rejects(requestOrderRefund(b, order, p), { status: 404 });
          for (const amountKobo of [0, -1, 0.5, 2147483648])
            await assert.rejects(requestOrderRefund(a, order, { ...p, amountKobo }));
          await assert.rejects(requestOrderRefund(a, order, { ...p, amountKobo: 10001 }), { status: 409 });
          const first = await requestOrderRefund(a, order, p);
          assert.deepEqual(await requestOrderRefund(a, order, p), first);
          await assert.rejects(requestOrderRefund(a, order, { ...p, amountKobo: 3001 }), { status: 409 });
          assert.equal((await purchases(b)).orders.length, 0);
        },
      );
      await t.test(
        "no role, wrong role, missing/stale/future MFA and stale revision cannot approve",
        async () => {
          const order = await fixture(),
            r = await requestOrderRefund(a, order, payload(3000));
          for (const actor of [
            { ...staff, identityId: a.identityId },
            { ...staff, identityId: b.identityId },
            { ...staff, identityId: contentOnly },
            { ...staff, recentMfa: false },
            { ...staff, verifiedAt: Date.now() - 300001 },
            { ...staff, verifiedAt: NaN },
            { ...staff, verifiedAt: Date.now() + 60000 },
          ]) {
            await assert.rejects(decideRefund(actor, r.reference, decision()), { status: 403 });
          }
          await assert.rejects(decideRefund(staff, r.reference, decision(2)), { status: 409 });
          assert.equal((await row(r.reference))!.status, "requested");
          await decideRefund(staff, r.reference, { ...decision(), decision: "reject" });
          assert.equal((await row(r.reference))!.status, "rejected");
          assert.equal(refundBalance(10000, [(await row(r.reference))!]).refundableKobo, 10000);
        },
      );
      await t.test("concurrent partial requests cannot reserve more than the paid amount", async () => {
        const order = await fixture(),
          r = await Promise.allSettled([
            requestOrderRefund(a, order, payload(7000)),
            requestOrderRefund(a, order, payload(7000)),
          ]);
        assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(r.filter((x) => x.status === "rejected").length, 1);
        const rows = await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, order));
        assert.equal(refundBalance(10000, rows).refundableKobo, 3000);
      });
      await t.test(
        "racing approve/reject decisions record one revision and one decision reason",
        async () => {
          const order = await fixture(),
            r = await requestOrderRefund(a, order, payload(1000));
          const outcomes = await Promise.allSettled([
            decideRefund(staff, r.reference, decision()),
            decideRefund(staff, r.reference, { ...decision(), decision: "reject" }),
          ]);
          assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
          assert.equal((await row(r.reference))!.version, 2);
          const log = await db
            .select()
            .from(valoRefundTransitions)
            .where(eq(valoRefundTransitions.refundId, r.reference));
          assert.equal(log.length, 2);
        },
      );
      await t.test(
        "provider pending is not complete; partial then full processing preserves private drafts",
        async () => {
          const order = await fixture(),
            id = await approved(order, 4000);
          await processRefund(id, adapter);
          let r = await row(id);
          assert.equal(r!.status, "pending");
          assert.equal(r!.completedAt, null);
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0]!.status,
            "active",
          );
          map.set(r!.reference, { ...map.get(r!.reference), status: "processed" });
          await due(id);
          await processRefund(id, adapter);
          r = await row(id);
          assert.equal(r!.status, "processed");
          assert.ok(r!.completedAt);
          let history = (await purchases(a)).orders.find((o) => o.id === order)!;
          assert.equal(history.refundedKobo, 4000);
          assert.equal(history.refundableKobo, 6000);
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0]!.status,
            "active",
          );
          const full = await approved(order, 6000);
          await processRefund(full, adapter);
          const second = await row(full);
          map.set(second!.reference, { ...map.get(second!.reference), status: "processed" });
          await due(full);
          await processRefund(full, adapter);
          history = (await purchases(a)).orders.find((o) => o.id === order)!;
          assert.equal(history.refundedKobo, 10000);
          assert.equal(history.refundableKobo, 0);
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0]!.status,
            "suspended",
          );
          assert.ok((await db.select().from(valoDocuments).where(eq(valoDocuments.id, draft.id)))[0]);
          await due(id);
          await processRefund(id, adapter, true);
          map.set(r!.reference, { ...map.get(r!.reference), status: "pending" });
          await due(id);
          await processRefund(id, adapter, true);
          assert.equal((await row(id))!.status, "processed");
          assert.equal(
            (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, order))).length,
            2,
          );
        },
      );
      await t.test(
        "timeout after provider acceptance reuses one reference and creates no second refund",
        async () => {
          const order = await fixture(),
            id = await approved(order, 2000);
          let posted = 0;
          const timeout: RefundProvider = {
            ...adapter,
            async create(input) {
              posted++;
              await adapter.create(input);
              throw Error("CONTROLLED_TIMEOUT_AFTER_ACCEPTANCE");
            },
          };
          await processRefund(id, timeout);
          assert.equal((await row(id))!.status, "unknown");
          await due(id);
          await processRefund(id, timeout);
          assert.equal((await row(id))!.status, "pending");
          assert.equal(posted, 1);
        },
      );
      await t.test(
        "parallel workers and changed provider facts never duplicate or falsely complete",
        async () => {
          const order = await fixture(),
            id = await approved(order, 1000),
            before = creates;
          await Promise.all(Array.from({ length: 6 }, () => processRefund(id, adapter)));
          assert.equal(creates - before, 1);
          let r = await row(id);
          assert.equal(r!.attempts, 1);
          map.set(r!.reference, { ...map.get(r!.reference), amount: 1001, status: "processed" });
          await due(id);
          await processRefund(id, adapter);
          r = await row(id);
          assert.equal(r!.status, "needs_review");
          assert.equal(r!.completedAt, null);
          assert.equal(refundBalance(10000, [r!]).refundableKobo, 9000);
          const valid = {
            id: "123",
            reference: r!.reference,
            domain: "test",
            amount: 1000,
            currency: "NGN",
            transaction: "456",
            status: "pending",
          };
          for (const change of [
            { currency: "USD" },
            { domain: "live" },
            { transaction: "457" },
            { reference: "wrong-reference" },
            { amount: 999 },
          ]) {
            assert.throws(() => assertRefundMatch(r!, "456", { ...valid, ...change }));
          }
        },
      );
      await t.test(
        "SIGKILL after committed claim recovers with the same reference and bounded attempts",
        async () => {
          const order = await fixture(),
            id = await approved(order, 1000);
          const child = fork(new URL("../../scripts/refund-crash-child.ts", import.meta.url), [id], {
            execArgv: ["--import", "tsx"],
            env: { ...process.env, NODE_ENV: "development" },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(Error("CHILD_CLAIM_TIMEOUT")), 15000);
              child.once("message", () => {
                clearTimeout(timer);
                resolve();
              });
              child.once("error", reject);
            });
            child.kill("SIGKILL");
            await new Promise<void>((resolve) => child.once("exit", () => resolve()));
            let r = await row(id);
            assert.equal(r!.status, "submitting");
            assert.equal(r!.attempts, 1);
            await db
              .update(valoRefundRequests)
              .set({ leaseUntil: new Date(Date.now() - 1000) })
              .where(eq(valoRefundRequests.id, id));
            await processRefund(id, adapter);
            r = await row(id);
            assert.equal(r!.status, "pending");
            assert.equal(r!.attempts, 2);
            await db
              .update(valoRefundRequests)
              .set({ status: "unknown", attempts: 5, nextAttemptAt: null })
              .where(eq(valoRefundRequests.id, id));
            await processRefund(id, adapter);
            assert.equal((await row(id))!.status, "needs_review");
            assert.equal((await row(id))!.attempts, 5);
          } finally {
            if (child.exitCode === null) child.kill("SIGKILL");
          }
        },
      );
      await t.test(
        "committed membership and finance revocations defeat writes waiting on an order",
        async () => {
          const order = await fixture();
          await blockedWrite(
            () => requestOrderRefund(a, order, payload(1000)),
            () =>
              db
                .update(valoMemberships)
                .set({ active: "no" })
                .where(eq(valoMemberships.identityId, a.identityId)),
            order,
          );
          await db
            .update(valoMemberships)
            .set({ active: "yes" })
            .where(eq(valoMemberships.identityId, a.identityId));
          const r = await requestOrderRefund(a, order, payload(1000));
          await blockedWrite(
            () => decideRefund(staff, r.reference, decision()),
            () =>
              db.update(valoStaffAssignments).set({ active: false }).where(eq(valoStaffAssignments.id, role)),
            order,
          );
          await db
            .update(valoStaffAssignments)
            .set({ active: true })
            .where(eq(valoStaffAssignments.id, role));
          assert.equal((await row(r.reference))!.status, "requested");
        },
      );
      await t.test(
        "canonical disputes suspend reuse, cannot be forged across transactions, and block double compensation",
        async () => {
          // A distinct tenant proves dispute history is scoped and avoids conflating
          // the preceding ten successful requests with this dispute-specific check.
          const order = await fixture(b),
            [o] = await db.select().from(valoOrders).where(eq(valoOrders.id, order));
          assert.ok(o);
          const disputeId = String(++idCounter),
            raw = {
              id: disputeId,
              domain: "test",
              status: "pending",
              resolution: null,
              refund_amount: null,
              currency: "NGN",
              transaction: {
                id: o.providerTransactionId,
                domain: "test",
                reference: o.reference,
                amount: 10000,
                currency: "NGN",
              },
            };
          await assert.rejects(
            storeVerifiedDispute(disputeId, { ...raw, transaction: { ...raw.transaction, amount: 10001 } }),
            { status: 409 },
          );
          await storeVerifiedDispute(disputeId, raw);
          await assert.rejects(requestOrderRefund(b, order, payload(1000)), { status: 409 });
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0]!.status,
            "suspended",
          );
          await storeVerifiedDispute(disputeId, {
            ...raw,
            status: "resolved",
            resolution: "merchant-accepted",
            refund_amount: 10000,
          });
          await storeVerifiedDispute(disputeId, raw);
          assert.equal(
            (await db.select().from(valoPaymentDisputes).where(eq(valoPaymentDisputes.orderId, order)))[0]!
              .status,
            "resolved",
          );
          const queue = await financeRefunds(staff);
          assert.ok(queue.policy.includes("not approved live"));
          assert.ok(!JSON.stringify(queue).includes(draft.title));
          assert.equal(
            (await purchases(a)).orders.find((o) => o.id === order),
            undefined,
          );
          assert.equal((await purchases(b)).orders.find((o) => o.id === order)?.disputeStatus, "resolved");
        },
      );
      await t.test(
        "first-observed terminal disputes preserve active grants without inventing financial outcomes",
        async () => {
          for (const status of ["resolved", "archived"]) {
            const order = await fixture(b),
              [before] = await db.select().from(valoOrders).where(eq(valoOrders.id, order));
            assert.ok(before);
            const [grant] = await db
              .select()
              .from(valoEntitlements)
              .where(eq(valoEntitlements.orderId, order));
            assert.ok(grant);
            const providerId = String(++idCounter),
              raw = {
                id: providerId,
                domain: "test",
                status,
                resolution: null,
                refund_amount: null,
                currency: "NGN",
                transaction: {
                  id: before.providerTransactionId,
                  domain: "test",
                  reference: before.reference,
                  amount: 10000,
                  currency: "NGN",
                },
              };
            const observed = await storeVerifiedDispute(providerId, raw);
            assert.equal(observed.status, status);
            assert.equal(observed.orderId, order);
            assert.deepEqual(
              (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0],
              grant,
            );
            assert.equal(grant.status, "active");
            assert.deepEqual((await db.select().from(valoOrders).where(eq(valoOrders.id, order)))[0], before);
            assert.equal(
              (await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, order)))
                .length,
              0,
            );
            assert.equal(
              (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, order)))
                .length,
              0,
            );
          }
        },
      );
      await t.test(
        "dispute observations preserve separately suspended grants and reversed orders",
        async () => {
          for (const orderStatus of ["verified_success", "reversed"]) {
            const order = await fixture(b);
            await db.update(valoOrders).set({ status: orderStatus }).where(eq(valoOrders.id, order));
            const [before] = await db.select().from(valoOrders).where(eq(valoOrders.id, order));
            assert.ok(before);
            await db
              .update(valoEntitlements)
              .set({ status: "suspended" })
              .where(eq(valoEntitlements.orderId, order));
            const [grant] = await db
              .select()
              .from(valoEntitlements)
              .where(eq(valoEntitlements.orderId, order));
            const providerId = String(++idCounter),
              raw = {
                id: providerId,
                domain: "test",
                status: "pending",
                resolution: null,
                refund_amount: null,
                currency: "NGN",
                transaction: {
                  id: before.providerTransactionId,
                  domain: "test",
                  reference: before.reference,
                  amount: 10000,
                  currency: "NGN",
                },
              };
            for (const observation of [
              raw,
              { ...raw, status: "resolved", resolution: "declined", refund_amount: 0 },
              raw,
            ]) {
              await storeVerifiedDispute(providerId, observation);
              assert.deepEqual(
                (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order)))[0],
                grant,
              );
              assert.deepEqual(
                (await db.select().from(valoOrders).where(eq(valoOrders.id, order)))[0],
                before,
              );
            }
            assert.equal(
              (
                await db
                  .select()
                  .from(valoPaymentDisputes)
                  .where(eq(valoPaymentDisputes.providerId, providerId))
              )[0]!.status,
              "resolved",
            );
            assert.equal(
              (await db.select().from(valoRefundRequests).where(eq(valoRefundRequests.orderId, order)))
                .length,
              0,
            );
            assert.equal(
              (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, order)))
                .length,
              0,
            );
          }
        },
      );
      await t.test(
        "an explicitly exhausted refund counter blocks writes without losing saved history",
        async () => {
          const order = await fixture(),
            before = (await purchases(a)).orders.reduce((n, o) => n + o.refunds.length, 0);
          // Do not infer the current window's usage from unrelated earlier cases.
          // This negative fixture lowers remaining allowance for THIS synthetic
          // actor only. Cover the next window too to avoid a minute-rollover flake.
          const subject = quotaSubjectHash(process.env.SESSION_SECRET, "user", a.identityId);
          await db.execute(sql`insert into valo_rate_buckets(bucket,subject_hash,window_started_at,used_count,expires_at)
        select 'refund-create',${subject},stamp,10,stamp+interval '2 minutes'
        from (select date_trunc('minute',statement_timestamp())+i*interval '1 minute' as stamp
          from generate_series(0,1) as i) as windows
        on conflict(bucket,subject_hash,window_started_at)
        do update set used_count=greatest(valo_rate_buckets.used_count,10)`);
          await assert.rejects(
            requestOrderRefund(a, order, payload(1)),
            (e: unknown) => e instanceof ValoProblem && e.status === 429 && Boolean(e.retryAfter),
          );
          assert.equal(
            (await purchases(a)).orders.reduce((n, o) => n + o.refunds.length, 0),
            before,
          );
        },
      );
      await t.test(
        "legacy unknown amounts cannot be authorized; rejection is explicit and auditable",
        async () => {
          const order = await fixture(),
            id = randomUUID();
          await db.insert(valoRefundRequests).values({
            id,
            workspaceId: a.workspaceId,
            orderId: order,
            reference: `vr-test-${id}`,
            reason: "Legacy unknown-amount controlled fixture",
          });
          assert.equal(refundBalance(10000, [(await row(id))!]).refundableKobo, 0);
          await assert.rejects(decideRefund(staff, id, decision()), { status: 409 });
          await decideRefund(staff, id, { ...decision(), decision: "reject" });
          assert.equal((await row(id))!.status, "rejected");
        },
      );
      await t.test(
        "a verified failed provider refund releases funds; needs-attention does not invent completion",
        async () => {
          const order = await fixture(),
            id = randomUUID();
          // Explicit synthetic fixture avoids changing or resetting the real quota.
          await db.insert(valoRefundRequests).values({
            id,
            workspaceId: a.workspaceId,
            orderId: order,
            reference: `vr-test-${id}`,
            reason: "Controlled provider lifecycle fixture",
            amountKobo: 1000,
            policyVersion: "test-refund-v1",
          });
          await decideRefund(staff, id, decision());
          await processRefund(id, adapter);
          let r = await row(id);
          map.set(r!.reference, { ...map.get(r!.reference), status: "needs-attention" });
          await due(id);
          await processRefund(id, adapter);
          r = await row(id);
          assert.equal(r!.status, "needs_attention");
          assert.equal(r!.completedAt, null);
          map.set(r!.reference, { ...map.get(r!.reference), status: "failed" });
          await due(id);
          await processRefund(id, adapter);
          r = await row(id);
          assert.equal(r!.status, "failed");
          assert.equal(refundBalance(10000, [r!]).refundableKobo, 10000);
        },
      );
      await t.test("a late worker response cannot replace a newer completed observation", async () => {
        const order = await fixture(),
          id = randomUUID();
        await db.insert(valoRefundRequests).values({
          id,
          workspaceId: a.workspaceId,
          orderId: order,
          reference: `vr-test-${id}`,
          reason: "Controlled fenced-response fixture",
          amountKobo: 1000,
          policyVersion: "test-refund-v1",
        });
        await decideRefund(staff, id, decision());
        const saved = await row(id),
          [o] = await db.select().from(valoOrders).where(eq(valoOrders.id, order));
        assert.ok(o);
        const observed = {
          id: String(++idCounter),
          reference: saved!.reference,
          domain: "test",
          amount: 1000,
          currency: "NGN",
          transaction: o.providerTransactionId,
          status: "processed",
        };
        let release!: () => void,
          started!: () => void,
          first = true;
        const waiting = new Promise<void>((r) => (release = r)),
          ready = new Promise<void>((r) => (started = r));
        const slow: RefundProvider = {
          ...adapter,
          async find() {
            if (first) {
              first = false;
              started();
              await waiting;
              return { ...observed, status: "pending" };
            }
            return observed;
          },
        };
        const old = processRefund(id, slow);
        await ready;
        await db
          .update(valoRefundRequests)
          .set({ leaseUntil: new Date(Date.now() - 1000) })
          .where(eq(valoRefundRequests.id, id));
        await processRefund(id, slow);
        release();
        await old;
        assert.equal((await row(id))!.status, "processed");
        assert.equal(
          (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, order))).length,
          1,
        );
      });
      await t.test("reversed payment or a late processed refund blocks a newly unsafe dispatch", async () => {
        const reserve = async (order: string, amountKobo: number) => {
          const id = randomUUID();
          await db.insert(valoRefundRequests).values({
            id,
            workspaceId: a.workspaceId,
            orderId: order,
            reference: `vr-test-${id}`,
            reason: "Controlled late-financial-state fixture",
            amountKobo,
            policyVersion: "test-refund-v1",
          });
          await decideRefund(staff, id, decision());
          return id;
        };
        const reversed = await fixture(),
          held = await reserve(reversed, 1000),
          start = creates;
        await db.update(valoOrders).set({ status: "reversed" }).where(eq(valoOrders.id, reversed));
        await processRefund(held, adapter);
        assert.equal((await row(held))!.failure, "PAYMENT_STATE_CHANGED");
        assert.equal(creates, start);
        const order = await fixture(),
          old = await reserve(order, 4000);
        await processRefund(old, adapter);
        const original = await row(old);
        map.set(original!.reference, { ...map.get(original!.reference), status: "failed" });
        await due(old);
        await processRefund(old, adapter);
        const replacement = await reserve(order, 10000);
        map.set(original!.reference, { ...map.get(original!.reference), status: "processed" });
        await due(old);
        await processRefund(old, adapter, true);
        assert.equal((await row(old))!.status, "processed");
        const before = creates;
        await processRefund(replacement, adapter);
        assert.equal((await row(replacement))!.failure, "REFUND_BALANCE_CHANGED");
        assert.equal(creates, before);
      });
      await t.test("the database rejects changes to financial transition history", async () => {
        const [r] = await db
          .select()
          .from(valoRefundTransitions)
          .where(inArray(valoRefundTransitions.workspaceId, ids))
          .limit(1);
        assert.ok(r);
        await assert.rejects(
          db
            .update(valoRefundTransitions)
            .set({ reason: "tampered" })
            .where(eq(valoRefundTransitions.id, r.id)),
        );
        await assert.rejects(db.delete(valoRefundTransitions).where(eq(valoRefundTransitions.id, r.id)));
        const [unchanged] = await db
          .select()
          .from(valoRefundTransitions)
          .where(eq(valoRefundTransitions.id, r.id));
        assert.ok(unchanged);
        assert.equal(unchanged.reason, r.reason);
      });
      // PAY-007: "finance can resolve a discrepancy with an audit trail and without editing financial
      // history directly" (docs/architecture/reconciliation.md, slice 2). Each check here is made for a day
      // of its own, so the daily check of other tests never meets one.
      let checkDay = 0;
      const nextDay = () => `2025-01-01`.replace(/01$/, String(++checkDay).padStart(2, "0"));
      const check = async (order: string, status: string, finding: string | null, day = nextDay()) =>
        singleRow(
          await db
            .insert(valoPaymentReconciliations)
            .values({ id: randomUUID(), workspaceId: a.workspaceId, orderId: order, day, status, finding })
            .returning(),
        );
      const differenceReading = async () =>
        Number(
          (await db.execute<{ value: number }>(sql.raw(readinessQueries.paymentDifferences))).rows[0]!.value,
        );
      const listed = async (id: string) => {
        const view = await financePaymentChecks(staff);
        return {
          open: view.differences.some((row) => row.id === id),
          settled: view.settled.find((row) => row.id === id),
        };
      };
      const orderFacts = async (id: string) => {
        const [order] = await db.select().from(valoOrders).where(eq(valoOrders.id, id));
        const grants = await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, id));
        return [order, grants];
      };
      const reason = "Synthetic: compared the order with Paystack's own record; the event arrived late.";
      await t.test(
        "finance settles a difference a daily payment check found, with its reason in the staff audit, the order unchanged, and the alert's reading and finance's list then leave it out until something new is found",
        async () => {
          const order = await fixture();
          const found = await check(order, "needs_review", "EVENT_MISSING;ENTITLEMENT_DIFFERENCE");
          const before = await differenceReading(),
            facts = await orderFacts(order);
          assert.deepEqual(await listed(found.id), { open: true, settled: undefined });
          const settled = await settlePaymentCheck(staff, found.id, { outcome: "explained", reason });
          assert.deepEqual(
            [settled.status, settled.outcome, settled.resolvedByYou, settled.reason, settled.reference],
            ["resolved", "explained", true, reason, `valo-test-${order}`],
          );
          // The check records the outcome, who and when; the audit keeps why, from the same transaction.
          const [row] = await db
            .select()
            .from(valoPaymentReconciliations)
            .where(eq(valoPaymentReconciliations.id, found.id));
          assert.deepEqual(
            [row!.status, row!.outcome, row!.resolvedBy],
            ["resolved", "explained", staff.identityId],
          );
          const audit = await db
            .select()
            .from(valoStaffAccessAudit)
            .where(eq(valoStaffAccessAudit.object, `payment_check:${found.id}`));
          assert.deepEqual(
            audit.map((entry) => [entry.actorId, entry.area, entry.reason, entry.createdAt.getTime()]),
            [
              [
                staff.identityId,
                "finance",
                `Payment check ${found.id}: explained; ${reason}`,
                row!.resolvedAt!.getTime(),
              ],
            ],
          );
          // Nothing about the order, its payment or its grants changed.
          assert.deepEqual(await orderFacts(order), facts);
          // The alert's reading and finance's list leave it out; the list shows it settled, with its reason.
          assert.equal(await differenceReading(), before - 1);
          const view = await listed(found.id);
          assert.equal(view.open, false);
          assert.deepEqual(
            [view.settled?.outcome, view.settled?.reason, view.settled?.resolvedByYou],
            ["explained", reason, true],
          );
          // Settled once: a second settlement is refused.
          await assert.rejects(settlePaymentCheck(staff, found.id, { outcome: "explained", reason }), {
            status: 409,
          });
          // The next day's check finds part of what was settled: still settled.
          const again = await check(order, "needs_review", "EVENT_MISSING");
          assert.equal(await differenceReading(), before - 1);
          assert.equal((await listed(again.id)).open, false);
          await assert.rejects(settlePaymentCheck(staff, again.id, { outcome: "explained", reason }), {
            status: 409,
          });
          // Something new: counted and listed again.
          const more = await check(order, "needs_review", "EVENT_MISSING;RECEIPT_OUTBOX_MISSING");
          assert.equal(await differenceReading(), before);
          assert.equal((await listed(more.id)).open, true);
          await settlePaymentCheck(staff, more.id, { outcome: "explained", reason });
          // A check that matched ends what was settled: the same finding after it is a new difference.
          await check(order, "matched", null);
          const after = await check(order, "needs_review", "EVENT_MISSING");
          assert.equal(await differenceReading(), before);
          assert.equal((await listed(after.id)).open, true);
          await settlePaymentCheck(staff, after.id, { outcome: "explained", reason });
          assert.equal(await differenceReading(), before - 1);
        },
      );
      await t.test(
        "a payment check is settled only by finance with a fresh second factor and a reason, only while it is its order's latest unsettled difference, and an order held as paid is never settled as having no payment",
        async () => {
          const paid = await fixture();
          const found = await check(paid, "needs_review", "EVENT_MISSING");
          const settle = (actor: FinanceActor, body: unknown = { outcome: "explained", reason }) =>
            settlePaymentCheck(actor, found.id, body);
          // Support and content staff, and finance without a fresh second factor, are refused.
          for (const identityId of [b.identityId, contentOnly])
            await assert.rejects(settle({ identityId, recentMfa: true, verifiedAt: Date.now() }), {
              status: 403,
            });
          await assert.rejects(settle({ ...staff, recentMfa: false }), { status: 403 });
          await assert.rejects(settle({ ...staff, verifiedAt: Date.now() - 600_000 }), { status: 403 });
          // A reason of fewer than ten characters, and an outcome Valo does not know, are refused.
          await assert.rejects(settle(staff, { outcome: "explained", reason: "Too short" }));
          await assert.rejects(settle(staff, { outcome: "refunded", reason }));
          await assert.rejects(settle(staff, { outcome: "explained", reason, extra: true }));
          // A check that matched, one still waiting, and one a later check has followed are not settled.
          for (const status of ["matched", "pending"]) {
            const other = await check(paid, status, null);
            await assert.rejects(settlePaymentCheck(staff, other.id, { outcome: "explained", reason }), {
              status: 409,
            });
          }
          const settledRows = async () =>
            (
              await db
                .select()
                .from(valoPaymentReconciliations)
                .where(eq(valoPaymentReconciliations.orderId, paid))
            ).filter((row) => row.status === "resolved").length;
          await assert.rejects(settle(staff), { status: 409 });
          assert.equal(await settledRows(), 0);
          // An order held as paid is not settled as having no payment, by the service or by the database.
          const latest = await check(paid, "needs_review", "EVENT_MISSING");
          await assert.rejects(
            settlePaymentCheck(staff, latest.id, { outcome: "no_payment_stands", reason }),
            { status: 409, message: /holds this order as paid/ },
          );
          // An abandoned order the provider was offered: settled as having no payment, the second look no
          // longer asks about it before a new order for its edition.
          const abandoned = await fixture();
          await db.update(valoOrders).set({ status: "abandoned" }).where(eq(valoOrders.id, abandoned));
          const look = () => db.transaction((tx) => endedEditionOrders(tx, a, [price.contentVersionId]));
          assert.ok((await look()).includes(abandoned));
          const unanswered = await check(abandoned, "needs_review", "NO_ANSWER");
          await settlePaymentCheck(staff, unanswered.id, { outcome: "no_payment_stands", reason });
          assert.equal((await look()).includes(abandoned), false);
          assert.deepEqual(
            (await db.select().from(valoOrders).where(eq(valoOrders.id, abandoned))).map((row) => row.status),
            ["abandoned"],
          );
        },
      );
      await t.test(
        "the database keeps a finished payment check: a settlement needs finance's reason recorded in the same transaction, once, and nothing else changes but an erasure's finding",
        async () => {
          const order = await fixture();
          const refused = (text: RegExp) => (error: unknown) => {
            const cause = (error as { cause?: { message?: string } }).cause;
            return text.test(`${(error as Error).message} ${cause?.message ?? ""}`);
          };
          const settlement = (id: string, outcome = "explained", resolvedBy = staff.identityId) =>
            sql`UPDATE valo_payment_reconciliations SET status = 'resolved', outcome = ${outcome},
              resolved_by = ${resolvedBy}, resolved_at = now() WHERE id = ${id}::uuid`;
          const audit = (id: string, assignmentId = role, actorId = staff.identityId) =>
            sql`INSERT INTO valo_staff_access_audit (id, assignment_id, actor_id, area, object, reason)
              VALUES (gen_random_uuid(), ${assignmentId}::uuid, ${actorId}, 'finance', ${"payment_check:" + id},
                'Synthetic settlement for the guard''s test')`;
          const found = await check(order, "needs_review", "EVENT_MISSING");
          // Without the audit's row, with one from another transaction, or from another role, it is refused.
          await assert.rejects(db.execute(settlement(found.id)), refused(/settled only by finance/));
          await db.execute(audit(found.id));
          await assert.rejects(db.execute(settlement(found.id)), refused(/settled only by finance/));
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(found.id, supportRole, b.identityId));
              await tx.execute(settlement(found.id, "explained", b.identityId));
            }),
            refused(/settled only by finance/),
          );
          // At a time other than its transaction's, it is refused too.
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(found.id));
              await tx.execute(sql`UPDATE valo_payment_reconciliations SET status = 'resolved', outcome = 'explained',
                resolved_by = ${staff.identityId}, resolved_at = now() - interval '1 second' WHERE id = ${found.id}::uuid`);
            }),
            refused(/settled only by finance/),
          );
          // An order held as paid is not settled as having no payment, even with the audit's row.
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(found.id));
              await tx.execute(settlement(found.id, "no_payment_stands"));
            }),
            refused(/held as paid|holds as paid/),
          );
          // With finance's reason recorded in the same transaction, it is settled, once.
          await db.transaction(async (tx) => {
            await tx.execute(audit(found.id));
            await tx.execute(settlement(found.id));
          });
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(found.id));
              await tx.execute(sql`UPDATE valo_payment_reconciliations SET outcome = 'no_payment_stands',
                resolved_at = now() WHERE id = ${found.id}::uuid`);
            }),
            refused(/never changed/),
          );
          // A finished check changes nothing else: not its finding, not its attempts, not its day.
          const matched = await check(order, "matched", null);
          for (const change of [
            sql`UPDATE valo_payment_reconciliations SET finding = 'AMOUNT_DIFFERENCE' WHERE id = ${found.id}::uuid`,
            sql`UPDATE valo_payment_reconciliations SET attempts = 1 WHERE id = ${matched.id}::uuid`,
            sql`UPDATE valo_payment_reconciliations SET status = 'needs_review', finding = 'EVENT_MISSING' WHERE id = ${matched.id}::uuid`,
          ])
            await assert.rejects(db.execute(change), refused(/never changed/));
          await assert.rejects(
            db.execute(
              sql`UPDATE valo_payment_reconciliations SET day = '2024-12-31' WHERE id = ${matched.id}::uuid`,
            ),
            refused(/keeps the order and the day/),
          );
          // A waiting check is finished by the daily check, never settled.
          const waiting = await check(order, "pending", null);
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(waiting.id));
              await tx.execute(settlement(waiting.id));
            }),
            refused(/waiting payment check/),
          );
          await db.execute(
            sql`UPDATE valo_payment_reconciliations SET attempts = 1, last_attempt_at = now() WHERE id = ${waiting.id}::uuid`,
          );
          // An erasure rewrites a finding, and only that.
          await db.execute(
            sql`UPDATE valo_payment_reconciliations SET finding = 'PRIVACY_ERASURE_FINANCE_REVIEW' WHERE id = ${found.id}::uuid`,
          );
          await assert.rejects(
            db.execute(sql`UPDATE valo_payment_reconciliations SET finding = 'PRIVACY_ERASURE_FINANCE_REVIEW', attempts = 2
              WHERE id = ${matched.id}::uuid`),
            refused(/never changed/),
          );
          const [erased] = await db
            .select()
            .from(valoPaymentReconciliations)
            .where(eq(valoPaymentReconciliations.id, found.id));
          assert.deepEqual(
            [erased!.status, erased!.outcome, erased!.finding],
            ["resolved", "explained", "PRIVACY_ERASURE_FINANCE_REVIEW"],
          );
        },
      );
      // PAY-007 (docs/architecture/reconciliation.md, slice 3a): a provider event Valo could not match or
      // process is settled by finance with its reason, and the event itself is left as it was. Each event
      // here names a reference no order has, so the event worker of other tests never takes one.
      const event = async (failure: string | null, status = "needs_review", eventType = "charge.success") =>
        singleRow(
          await db
            .insert(valoPaymentEvents)
            .values({
              id: randomUUID(),
              eventKey: `test:${eventType}:synthetic-${randomUUID()}`,
              bodyHash: "synthetic-body-hash",
              eventType,
              reference: `valo-test-unmatched-${randomUUID()}`,
              status,
              attempts: 1,
              failure,
            })
            .returning(),
        );
      const eventReading = async () =>
        Number(
          (await db.execute<{ value: number }>(sql.raw(readinessQueries.unmatchedPaymentEvents))).rows[0]!
            .value,
        );
      const eventListed = async (id: string) => {
        const view = await financePaymentEvents(staff);
        return {
          waiting: view.waiting.some((row) => row.id === id),
          settled: view.settled.filter((row) => row.id === id),
        };
      };
      const eventRow = async (id: string) =>
        (await db.select().from(valoPaymentEvents).where(eq(valoPaymentEvents.id, id)))[0];
      const found = "Synthetic: Paystack's dashboard shows a test payment that no order of Valo's made.";
      await t.test(
        "finance settles a Paystack event Valo could not match, with its reason in the staff audit and the event unchanged, and the alert's reading and finance's list then leave it out until its finding changes",
        async () => {
          const unmatched = await event("UNMATCHED_REFERENCE");
          const before = await eventReading(),
            stored = await eventRow(unmatched.id);
          assert.deepEqual(await eventListed(unmatched.id), { waiting: true, settled: [] });
          const settled = await settlePaymentEvent(staff, unmatched.id, { reason: found });
          assert.deepEqual(
            [settled.finding, settled.resolvedByYou, settled.reason, settled.reference, settled.eventType],
            ["UNMATCHED_REFERENCE", true, found, unmatched.reference, "charge.success"],
          );
          // The settlement records the finding, who and when; the audit keeps why, from the same transaction.
          const settlements = await db
            .select()
            .from(valoPaymentEventSettlements)
            .where(eq(valoPaymentEventSettlements.eventId, unmatched.id));
          assert.deepEqual(
            settlements.map((row) => [row.finding, row.resolvedBy]),
            [["UNMATCHED_REFERENCE", staff.identityId]],
          );
          const audit = await db
            .select()
            .from(valoStaffAccessAudit)
            .where(eq(valoStaffAccessAudit.object, `payment_event:${unmatched.id}`));
          assert.deepEqual(
            audit.map((entry) => [entry.actorId, entry.area, entry.reason, entry.createdAt.getTime()]),
            [
              [
                staff.identityId,
                "finance",
                `Payment event ${unmatched.id}: ${found}`,
                settlements[0]!.resolvedAt.getTime(),
              ],
            ],
          );
          // The event itself is left as it was.
          assert.deepEqual(await eventRow(unmatched.id), stored);
          // The alert's reading and finance's list leave it out; the list shows it settled, with its reason.
          assert.equal(await eventReading(), before - 1);
          const view = await eventListed(unmatched.id);
          assert.equal(view.waiting, false);
          assert.deepEqual(
            view.settled.map((row) => [row.finding, row.reason, row.resolvedByYou]),
            [["UNMATCHED_REFERENCE", found, true]],
          );
          // Settled once: a second settlement is refused.
          await assert.rejects(settlePaymentEvent(staff, unmatched.id, { reason: found }), { status: 409 });
          // An erasure rewrites its finding: it waits again, and is settled again with the finding it has.
          await db
            .update(valoPaymentEvents)
            .set({ failure: "PRIVACY_ERASURE_FINANCE_REVIEW" })
            .where(eq(valoPaymentEvents.id, unmatched.id));
          assert.equal(await eventReading(), before);
          assert.equal((await eventListed(unmatched.id)).waiting, true);
          const again = await settlePaymentEvent(staff, unmatched.id, { reason: found });
          assert.equal(again.finding, "PRIVACY_ERASURE_FINANCE_REVIEW");
          assert.equal(await eventReading(), before - 1);
          // An event Valo processed, one still waiting for the worker, and one that is not there are not
          // settled.
          for (const status of ["processed", "pending", "ignored"]) {
            const other = await event(status === "pending" ? "NO_ANSWER" : null, status);
            await assert.rejects(settlePaymentEvent(staff, other.id, { reason: found }), { status: 409 });
            // The event worker of a later test takes every waiting event: this one is not left for it.
            if (status === "pending")
              await db.delete(valoPaymentEvents).where(eq(valoPaymentEvents.id, other.id));
          }
          await assert.rejects(settlePaymentEvent(staff, randomUUID(), { reason: found }), { status: 404 });
          // Each kind of event the worker leaves for finance is counted and listed until it is settled.
          for (const finding of ["RECORD_DIFFERENCE", "NO_ANSWER", "SERVER_VERIFICATION_REQUIRED"]) {
            const other = await event(finding, "needs_review", "refund.processed");
            assert.equal(await eventReading(), before);
            assert.equal((await eventListed(other.id)).waiting, true);
            await settlePaymentEvent(staff, other.id, { reason: found });
            assert.equal(await eventReading(), before - 1);
          }
        },
      );
      await t.test(
        "a Paystack event is settled only by finance with a fresh second factor and a reason of ten characters or more",
        async () => {
          const unmatched = await event("UNMATCHED_REFERENCE");
          const settle = (actor: FinanceActor, body: unknown = { reason: found }) =>
            settlePaymentEvent(actor, unmatched.id, body);
          // Support and content staff, and finance without a fresh second factor, are refused, and the list is
          // refused to them as well.
          for (const identityId of [b.identityId, contentOnly]) {
            const actor = { identityId, recentMfa: true, verifiedAt: Date.now() };
            await assert.rejects(settle(actor), { status: 403 });
            await assert.rejects(financePaymentEvents(actor), { status: 403 });
          }
          await assert.rejects(settle({ ...staff, recentMfa: false }), { status: 403 });
          await assert.rejects(settle({ ...staff, verifiedAt: Date.now() - 600_000 }), { status: 403 });
          // A reason of fewer than ten characters, and anything more than a reason, are refused.
          await assert.rejects(settle(staff, { reason: "Too short" }));
          await assert.rejects(settle(staff, { reason: found, outcome: "explained" }));
          assert.deepEqual(
            await db
              .select()
              .from(valoPaymentEventSettlements)
              .where(eq(valoPaymentEventSettlements.eventId, unmatched.id)),
            [],
          );
          assert.equal((await eventListed(unmatched.id)).waiting, true);
        },
      );
      await t.test(
        "the database keeps a settlement of a Paystack event: it needs finance's reason recorded in the same transaction, for the finding the event has, and is never changed or removed",
        async () => {
          const refused = (text: RegExp) => (error: unknown) => {
            const cause = (error as { cause?: { message?: string } }).cause;
            return text.test(`${(error as Error).message} ${cause?.message ?? ""}`);
          };
          const settlement = (
            id: string,
            finding = "UNMATCHED_REFERENCE",
            resolvedBy = staff.identityId,
            at = sql`now()`,
          ) => sql`INSERT INTO valo_payment_event_settlements (id, event_id, finding, resolved_by, resolved_at)
              VALUES (gen_random_uuid(), ${id}::uuid, ${finding}, ${resolvedBy}, ${at})`;
          const audit = (id: string, assignmentId = role, actorId = staff.identityId) =>
            sql`INSERT INTO valo_staff_access_audit (id, assignment_id, actor_id, area, object, reason)
              VALUES (gen_random_uuid(), ${assignmentId}::uuid, ${actorId}, 'finance', ${"payment_event:" + id},
                'Synthetic settlement for the guard''s test')`;
          const unmatched = await event("UNMATCHED_REFERENCE");
          // Without the audit's row, with one from another transaction, or from another role, it is refused.
          await assert.rejects(db.execute(settlement(unmatched.id)), refused(/settled only by finance/));
          await db.execute(audit(unmatched.id));
          await assert.rejects(db.execute(settlement(unmatched.id)), refused(/settled only by finance/));
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(unmatched.id, supportRole, b.identityId));
              await tx.execute(settlement(unmatched.id, "UNMATCHED_REFERENCE", b.identityId));
            }),
            refused(/settled only by finance/),
          );
          // At a time other than its transaction's, it is refused too.
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(audit(unmatched.id));
              await tx.execute(
                settlement(
                  unmatched.id,
                  "UNMATCHED_REFERENCE",
                  staff.identityId,
                  sql`now() - interval '1 second'`,
                ),
              );
            }),
            refused(/settled only by finance/),
          );
          // With a finding other than the event's, or of an event that does not need review, it is refused.
          const processed = await event(null, "processed");
          for (const [id, finding] of [
            [unmatched.id, "NO_ANSWER"],
            [processed.id, ""],
          ] as const)
            await assert.rejects(
              db.transaction(async (tx) => {
                await tx.execute(audit(id));
                await tx.execute(settlement(id, finding));
              }),
              refused(/only while it needs review, with the finding it has/),
            );
          // With finance's reason recorded in the same transaction, it is taken.
          await db.transaction(async (tx) => {
            await tx.execute(audit(unmatched.id));
            await tx.execute(settlement(unmatched.id));
          });
          // It is never changed or removed, and the table is never emptied.
          for (const change of [
            sql`UPDATE valo_payment_event_settlements SET finding = 'NO_ANSWER' WHERE event_id = ${unmatched.id}::uuid`,
            sql`UPDATE valo_payment_event_settlements SET resolved_at = now() WHERE event_id = ${unmatched.id}::uuid`,
            sql`DELETE FROM valo_payment_event_settlements WHERE event_id = ${unmatched.id}::uuid`,
          ])
            await assert.rejects(db.execute(change), refused(/never changed or removed/));
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(sql`TRUNCATE valo_payment_event_settlements`);
              throw new Error("SYNTHETIC_TRUNCATE_WAS_NOT_REFUSED");
            }),
            refused(/cannot be truncated/),
          );
          // The event a settlement is about is never removed from under it.
          await assert.rejects(db.delete(valoPaymentEvents).where(eq(valoPaymentEvents.id, unmatched.id)));
          assert.equal(
            (
              await db
                .select()
                .from(valoPaymentEventSettlements)
                .where(eq(valoPaymentEventSettlements.eventId, unmatched.id))
            ).length,
            1,
          );
        },
      );
      console.log(
        JSON.stringify({
          realPaystackCalls: 0,
          controlledProviderOnly: true,
          realKernelSigkill: true,
          leaseClockAdvance: "owned synthetic row",
          livePayments: false,
          publicationsCreated: 0,
          privateDraftPreserved: true,
          syntheticFinancialParentsRetainedForAudit: true,
        }),
      );
    } finally {
      // Never disable immutable finance evidence for teardown. Retain financial
      // rows plus their explicitly synthetic order/price/workspace FK parents.
      for (const table of [valoDocumentRevisions, valoDocuments])
        await db.delete(table).where(inArray(table.workspaceId, ids));
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(inArray(valoStaffAssignments.id, [role, supportRole, contentRole]));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
      await pool.end();
    }
  },
);
