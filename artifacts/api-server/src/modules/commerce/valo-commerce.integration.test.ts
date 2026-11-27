import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoPrices,
  valoPriceChanges,
  valoOrders,
  valoEntitlements,
  valoPurchaseOutbox,
  valoPaymentEvents,
  valoEvents,
  valoMemberships,
} from "@workspace/db";
import { resolveWorkspace } from "../workspaces";
import * as commerce from "./valo-commerce";
import { endedEditionOrders, priceOrderTerms } from "./checkout-editions";
import { purchaseReceiptFile } from "./purchase-receipt-file";
import { PAYSTACK_API, verifiedTransaction } from "./valo-paystack-contract";
import { quotaSubjectHash } from "../../lib/valo-quota";
import { setting } from "../../platform/settings";
import { financeHeldFixture, freshHeldFixture } from "./valo-finance-test-fixture";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { erasePrivateCopyPhase } from "../privacy/valo-private-copy-inventory";
import { plantOrderLine } from "../../test-support/planted-order-line";

test(
  "controlled PostgreSQL commerce mechanics — NOT real Paystack execution or publication",
  { timeout: 40000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    const a = await resolveWorkspace(`synthetic-commerce-${randomUUID()}`),
      b = await resolveWorkspace(`synthetic-commerce-${randomUUID()}`);
    // Reuse an actual held development version; never insert or forge a release.
    const held = await financeHeldFixture();
    assert.ok(
      held,
      "An actual held development candidate is required for this non-publication mechanics proof.",
    );
    const version = held.id,
      priceId = randomUUID(),
      workspaces = [a.workspaceId, b.workspaceId];
    const fixtureLine = {
      title: "CONTROLLED TEST ONLY — not a released product",
      contentVersionId: version,
      licenceVersion: "controlled-not-approved",
      licenceText: "CONTROLLED TEST ONLY. Not commercial terms approval.",
      taxTreatment: "Test amount only; no tax assertion.",
    };
    const orders: string[] = [],
      eventKeys: string[] = [];
    /** A renderer for a receipt file that must be refused before any file is made. */
    const neverRendered = async (): Promise<Buffer> => {
      throw Error("A receipt file was made for an order whose receipt the caller may not read.");
    };
    // The price an order is made from: the one in effect. The first, then the later one that a subtest
    // replaces it with.
    let offer: typeof valoPrices.$inferSelect | undefined;
    async function fixture(actor = a) {
      if (!offer) throw Error("This test's price has not been made yet.");
      const id = randomUUID();
      orders.push(id);
      const [row] = await db
        .insert(valoOrders)
        .values({
          id,
          workspaceId: actor.workspaceId,
          requestedBy: actor.identityId,
          requestKey: randomUUID(),
          reference: `valo-test-${id}`,
          ...priceOrderTerms(offer),
        })
        .returning();
      return row;
    }
    function response(o: Awaited<ReturnType<typeof fixture>>, patch: Record<string, unknown> = {}) {
      return verifiedTransaction.parse({
        id: String(Math.floor(Math.random() * 1e12)),
        domain: "test",
        reference: o!.reference,
        status: "success",
        amount: o!.amountKobo,
        currency: "NGN",
        metadata: { valoOrderId: o!.id, workspaceId: o!.workspaceId },
        ...patch,
      });
    }
    // Inside a transaction, commerce must use only that transaction's connection.
    const guard = guardNestedConnections({ db, pool });
    try {
      [offer] = await db
        .insert(valoPrices)
        .values({
          id: priceId,
          contentVersionId: version,
          title: fixtureLine.title,
          amountKobo: 12345,
          licenceVersion: fixtureLine.licenceVersion,
          licenceText: fixtureLine.licenceText,
          taxTreatment: fixtureLine.taxTreatment,
          approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
          effectiveFrom: new Date(Date.now() - 1000),
        })
        .returning();
      await t.test("held content and browser price/currency additions cannot create an order", async () => {
        await assert.rejects(
          commerce.createOrder(a, {
            priceId,
            requestKey: randomUUID(),
            acceptedLicenceVersion: fixtureLine.licenceVersion,
            acceptedCarriesToLaterEditions: true,
          }),
          { status: 409 },
        );
        await assert.rejects(
          commerce.createOrder(a, {
            priceId,
            requestKey: randomUUID(),
            acceptedLicenceVersion: fixtureLine.licenceVersion,
            acceptedCarriesToLaterEditions: true,
            amountKobo: 1,
            currency: "USD",
          }),
        );
        assert.equal((await commerce.purchases(a)).orders.length, 0);
        assert.equal(
          (await commerce.commerceProducts()).some((p) => p.id === priceId),
          false,
        );
      });
      const order = await fixture(),
        verified = response(order);
      await t.test(
        "saved controlled order is not a receipt or entitlement; no browser-success grant exists",
        async () => {
          assert.equal((await commerce.purchases(a)).orders[0]!.status, "created");
          await assert.rejects(commerce.purchaseReceipt(a, order!.id), { status: 409 });
          // Nor is a receipt file made for it (PAY-009).
          await assert.rejects(purchaseReceiptFile(a, order!.id, neverRendered), { status: 409 });
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order!.id))).length,
            0,
          );
        },
      );
      await t.test(
        "other tenants cannot read a receipt, refresh, checkout, settle or request a refund",
        async () => {
          for (const call of [
            () => commerce.purchaseReceipt(b, order!.id),
            () => purchaseReceiptFile(b, order!.id, neverRendered),
            () => commerce.refreshOrder(b, order!.id),
            () => commerce.startCheckout(b, order!.id, "synthetic@example.test"),
            () =>
              commerce.requestRefund(b, order!.id, {
                reason: "Controlled test request",
                amountKobo: 1000,
                requestKey: randomUUID(),
                acceptedPolicyVersion: "test-refund-v1",
              }),
            () => commerce.settleVerifiedOrder(order!.id, verified, b),
          ])
            await assert.rejects(call(), { status: 404 });
          assert.equal((await commerce.purchases(b)).orders.length, 0);
        },
      );
      await t.test(
        "mismatched amount and workspace never grant; data outside test mode is rejected",
        async () => {
          await assert.rejects(commerce.settleVerifiedOrder(order!.id, { ...verified, amount: 12346 }), {
            status: 409,
          });
          await assert.rejects(
            commerce.settleVerifiedOrder(order!.id, {
              ...verified,
              metadata: { ...verified.metadata, workspaceId: b.workspaceId },
            }),
            { status: 409 },
          );
          await assert.rejects(
            commerce.settleVerifiedOrder(order!.id, { ...verified, domain: "live" } as never),
          );
        },
      );
      await t.test(
        "concurrent controlled callback/webhook results grant one entitlement, one receipt outbox and one settlement event",
        async () => {
          const result = await Promise.all(
            Array.from({ length: 8 }, () => commerce.settleVerifiedOrder(order!.id, verified)),
          );
          assert.ok(result.every((r) => r.status === "verified_success"));
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order!.id))).length,
            1,
          );
          const outbox = await db
            .select()
            .from(valoPurchaseOutbox)
            .where(eq(valoPurchaseOutbox.orderId, order!.id));
          assert.equal(outbox.length, 1);
          assert.equal(outbox[0]!.status, "awaiting_email_configuration");
          const audit = await db
            .select()
            .from(valoEvents)
            .where(
              and(eq(valoEvents.entityId, order!.id), eq(valoEvents.action, "payment.verified_success")),
            );
          assert.equal(audit.length, 1);
        },
      );
      await t.test(
        "verified retries repair missing grant and receipt atomically once, without unsuspending a grant",
        async () => {
          const repair = await fixture(),
            data = response(repair);
          await commerce.settleVerifiedOrder(repair!.id, data);
          await db.delete(valoEntitlements).where(eq(valoEntitlements.orderId, repair!.id));
          await db.delete(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, repair!.id));
          await Promise.all([
            commerce.settleVerifiedOrder(repair!.id, data),
            commerce.settleVerifiedOrder(repair!.id, data),
          ]);
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, repair!.id))).length,
            1,
          );
          assert.equal(
            (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, repair!.id)))
              .length,
            1,
          );
          assert.equal(
            (
              await db
                .select()
                .from(valoEvents)
                .where(
                  and(
                    eq(valoEvents.entityId, repair!.id),
                    eq(valoEvents.action, "payment.fulfilment_repaired"),
                  ),
                )
            ).length,
            1,
          );
          await db
            .update(valoEntitlements)
            .set({ status: "suspended" })
            .where(eq(valoEntitlements.orderId, repair!.id));
          await db.delete(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, repair!.id));
          await commerce.settleVerifiedOrder(repair!.id, data);
          assert.equal(
            (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, repair!.id)))[0]!
              .status,
            "suspended",
          );
          assert.equal(
            (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, repair!.id)))
              .length,
            1,
          );
        },
      );
      await t.test(
        "receipt/licence history is private and independent of a later price version",
        async () => {
          // ADM-006: a price's terms never change in place. A change of price closes the current
          // row and adds a new one with its own effective dates, and the log records both.
          const databaseMessage = (pattern: RegExp) => (error: unknown) => {
            for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
              const item = e as { message?: unknown; cause?: unknown };
              if (pattern.test(String(item.message ?? ""))) return true;
              e = item.cause;
            }
            return false;
          };
          await assert.rejects(
            db
              .update(valoPrices)
              .set({ amountKobo: 99999, licenceText: "A later test price" })
              .where(eq(valoPrices.id, priceId)),
            databaseMessage(/Price terms never change in place/),
          );
          const laterPriceId = randomUUID();
          await db.transaction(async (tx) => {
            await tx
              .update(valoPrices)
              .set({ effectiveTo: sql`now()` })
              .where(eq(valoPrices.id, priceId));
            // Orders made from here on are this price's: it is the one in effect.
            [offer] = await tx
              .insert(valoPrices)
              .values({
                id: laterPriceId,
                contentVersionId: version,
                title: fixtureLine.title,
                amountKobo: 99999,
                licenceVersion: "controlled-not-approved-v2",
                licenceText: "A later test price",
                taxTreatment: fixtureLine.taxTreatment,
                approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
                effectiveFrom: sql`now()`,
              })
              .returning();
          });
          // The close and the new price share one transaction, so they share one time.
          const changes = (
            await db
              .select()
              .from(valoPriceChanges)
              .where(inArray(valoPriceChanges.priceId, [priceId, laterPriceId]))
              .orderBy(valoPriceChanges.changedAt)
          ).map((c) => ({
            change: `${c.priceId === priceId ? "first" : "later"}:${c.action}`,
            amount: c.price.amount_kobo,
            closed: c.price.effective_to !== null,
          }));
          assert.deepEqual(changes[0], { change: "first:created", amount: 12345, closed: false });
          assert.deepEqual(
            changes.slice(1).sort((x, y) => x.change.localeCompare(y.change)),
            [
              { change: "first:closed", amount: 12345, closed: true },
              { change: "later:created", amount: 99999, closed: false },
            ],
          );
          const receipt = await commerce.purchaseReceipt(a, order!.id);
          assert.equal(receipt.amountKobo, 12345);
          assert.equal(receipt.licenceText, fixtureLine.licenceText);
          assert.match(receipt.notice, /test-mode/);
          assert.equal(receipt.deliveryStatus, "awaiting_email_configuration");
          assert.equal(receipt.receiptReference, `VALO-TEST-${order!.reference}`);
          // The receipt as a file (PAY-009; docs/architecture/messages.md, part 5): made from the order's
          // own record, named by the receipt's reference, with no pooled connection held while it is made.
          let rendered: typeof order | undefined,
            connectionsHeldWhileMade = -1;
          const file = await purchaseReceiptFile(a, order!.id, async (record) => {
            rendered = record;
            connectionsHeldWhileMade = pool.totalCount - pool.idleCount;
            return Buffer.from("%PDF-synthetic");
          });
          assert.equal(connectionsHeldWhileMade, 0);
          assert.equal(rendered?.id, order!.id);
          assert.equal(rendered?.amountKobo, 12345);
          assert.equal(file.filename, `VALO-TEST-${order!.reference}.pdf`);
          assert.match(file.filename, /^[A-Za-z0-9._-]+$/);
          assert.equal(file.bytes.toString(), "%PDF-synthetic");
        },
      );
      await t.test(
        "duplicate refund requests persist once without completing a refund or deleting owned work",
        async () => {
          const payload = {
            reason: "Controlled test of refund request persistence",
            amountKobo: 12345,
            requestKey: randomUUID(),
            acceptedPolicyVersion: "test-refund-v1",
          };
          const r = await commerce.requestRefund(a, order!.id, payload);
          const again = await commerce.requestRefund(a, order!.id, payload);
          assert.deepEqual(r, again);
          assert.equal(r.status, "requested");
          const [grant] = await db
            .select()
            .from(valoEntitlements)
            .where(eq(valoEntitlements.orderId, order!.id));
          assert.ok(grant);
          assert.equal(grant.status, "active");
        },
      );
      await t.test("a failed fulfilment constraint rolls back settlement and outbox atomically", async () => {
        // An order whose line names a version that does not exist, so that granting it fails. The
        // database keeps an order's line, so the fault is put beneath its guards.
        const broken = await fixture();
        assert.ok(offer);
        await plantOrderLine(broken!.id, {
          ...priceOrderTerms(offer).line,
          contentVersionId: randomUUID(),
        });
        await assert.rejects(commerce.settleVerifiedOrder(broken!.id, response(broken)));
        const [saved] = await db.select().from(valoOrders).where(eq(valoOrders.id, broken!.id));
        assert.ok(saved);
        assert.equal(saved.status, "created");
        assert.equal(
          (await db.select().from(valoPurchaseOutbox).where(eq(valoPurchaseOutbox.orderId, broken!.id)))
            .length,
          0,
        );
      });
      await t.test(
        "pending, abandoned and failed provider controls do not grant; a late success can recover",
        async () => {
          for (const status of ["pending", "abandoned", "failed"] as const) {
            const o = await fixture(),
              data = response(o, { status });
            const result = await commerce.settleVerifiedOrder(o!.id, data);
            assert.equal(result.status, status);
            assert.equal(
              (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, o!.id))).length,
              0,
            );
            assert.equal(
              (await commerce.settleVerifiedOrder(o!.id, { ...data, status: "success" })).status,
              "verified_success",
            );
          }
        },
      );
      await t.test("reversal suspends reuse without deleting financial or customer history", async () => {
        await commerce.settleVerifiedOrder(order!.id, { ...verified, status: "reversed" });
        const receipt = await commerce.purchaseReceipt(a, order!.id);
        assert.equal(receipt.status, "reversed");
        assert.equal(receipt.amountKobo, order!.amountKobo);
        assert.equal(receipt.licenceText, fixtureLine.licenceText);
        assert.equal(receipt.receiptReference, `VALO-TEST-${order!.reference}`);
        assert.equal(
          (await commerce.purchases(a)).orders.find((o) => o.id === order!.id)?.receiptReference,
          receipt.receiptReference,
        );
        const [grant] = await db
          .select()
          .from(valoEntitlements)
          .where(eq(valoEntitlements.orderId, order!.id));
        assert.ok(grant);
        assert.equal(grant.status, "suspended");
        assert.equal(
          (await commerce.purchases(a)).orders.find((o) => o.id === order!.id)!.status,
          "reversed",
        );
        await assert.rejects(commerce.startCheckout(a, order!.id, "synthetic@example.test"), { status: 409 });
      });
      await t.test(
        "membership revoked while settlement waits on an order lock prevents the eventual customer write",
        async () => {
          const waiting = await fixture(),
            data = response(waiting),
            connection = await pool.connect();
          try {
            await connection.query("BEGIN");
            await connection.query("SELECT id FROM valo_orders WHERE id=$1 FOR UPDATE", [waiting!.id]);
            const write = commerce.settleVerifiedOrder(waiting!.id, data, a);
            let observed = false;
            for (let n = 0; n < 60; n++) {
              const r = await pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%valo_orders%' LIMIT 1",
              );
              if (r.rowCount) {
                observed = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.equal(observed, true, "observed actual blocked resource lock before revocation");
            await db
              .update(valoMemberships)
              .set({ active: "no" })
              .where(eq(valoMemberships.identityId, a.identityId));
            await connection.query("COMMIT");
            await assert.rejects(write, { status: 403 });
            assert.equal(
              (await db.select().from(valoOrders).where(eq(valoOrders.id, waiting!.id)))[0]!.status,
              "created",
            );
          } finally {
            await connection.query("ROLLBACK");
            connection.release();
            await db
              .update(valoMemberships)
              .set({ active: "yes" })
              .where(eq(valoMemberships.identityId, a.identityId));
          }
        },
      );
      await t.test(
        "durable event deduplication ignores whitespace and delivery retries without retaining card data",
        async () => {
          const event = {
            event: "charge.success",
            data: {
              id: order!.reference,
              reference: order!.reference,
              authorization: { card: "NOT_RETAINED" },
            },
          };
          eventKeys.push(`test:charge.success:${order!.reference}`);
          const first = await commerce.recordPaymentEvent(Buffer.from(JSON.stringify(event)));
          const second = await commerce.recordPaymentEvent(Buffer.from(JSON.stringify(event, null, 2)));
          assert.equal(first.duplicate, false);
          assert.equal(second.duplicate, true);
          const [row] = await db
            .select()
            .from(valoPaymentEvents)
            .where(eq(valoPaymentEvents.eventKey, eventKeys[0]!));
          assert.ok(row);
          assert.equal(row.status, "pending");
          assert.equal(JSON.stringify(row).includes("NOT_RETAINED"), false);
        },
      );
      await t.test(
        "no merchant setup means no provider calls, false match, consumed event attempt or claimed delivery",
        async () => {
          assert.equal(
            Boolean(process.env.PAYSTACK_SECRET_KEY),
            false,
            "this proof is explicitly credential-free",
          );
          await commerce.processPaymentEvents();
          await commerce.reconcilePayments();
          const [row] = await db
            .select()
            .from(valoPaymentEvents)
            .where(eq(valoPaymentEvents.eventKey, eventKeys[0]!));
          assert.ok(row);
          assert.equal(row.attempts, 0);
          assert.equal(row.status, "pending");
          const o = await fixture();
          await assert.rejects(commerce.refreshOrder(a, o!.id), { status: 503 });
          await assert.rejects(commerce.purchaseReceipt(a, o!.id), { status: 409 });
          // SEC-005: the refresh counted against checkout's minute ceiling and its day limit, each in
          // a counter of its own, and the day's counter starts at the day's start. (This customer's
          // refund requests above keep counters of their own, which are not read here.)
          const counters = await db.execute<{ bucket: string; daily: boolean; used: number }>(sql`
            select bucket,
              (window_started_at at time zone 'UTC') = date_trunc('day', window_started_at at time zone 'UTC') as daily,
              used_count as used
            from valo_rate_buckets
            where subject_hash = ${quotaSubjectHash(setting("SESSION_SECRET"), "user", a.identityId)}
              and bucket like 'checkout-%'
            order by bucket, window_started_at`);
          assert.deepEqual(
            [...new Set(counters.rows.map((r) => r.bucket))],
            ["checkout-create", "checkout-create-day"],
          );
          const day = counters.rows.filter((r) => r.bucket === "checkout-create-day");
          assert.equal(day.length, 1);
          assert.equal(day[0]!.daily, true);
          assert.ok(day[0]!.used >= 1);
        },
      );
      /** A Paystack test merchant for one subtest, with Paystack itself stood in for: `verify`
       * answers for the references `paid` maps to a transaction and fails for every other one. No
       * request leaves this process, and the settings are removed again afterwards. */
      async function withStandInMerchant(
        paid: Map<string, ReturnType<typeof response>>,
        run: (verified: string[]) => Promise<void>,
      ) {
        assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY), false);
        assert.equal(process.env.VALO_SANDBOX_CHECKOUT_ENABLED, undefined);
        const verified: string[] = [];
        const realFetch = globalThis.fetch;
        process.env.VALO_SANDBOX_CHECKOUT_ENABLED = "true";
        process.env.PAYSTACK_SECRET_KEY = "sk_test_synthetic_fixture_not_a_key";
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (!url.startsWith(PAYSTACK_API + "/")) return realFetch(input, init);
          const reference = decodeURIComponent(url.split("/transaction/verify/")[1] ?? "");
          verified.push(reference);
          const transaction = paid.get(reference);
          return transaction
            ? Response.json({ status: true, data: transaction })
            : new Response("{}", { status: 502 });
        }) as typeof fetch;
        try {
          await run(verified);
        } finally {
          globalThis.fetch = realFetch;
          delete process.env.VALO_SANDBOX_CHECKOUT_ENABLED;
          delete process.env.PAYSTACK_SECRET_KEY;
        }
      }
      const charge = async (reference: string) => {
        const id = Math.floor(Math.random() * 1e12);
        eventKeys.push(`test:charge.success:${id}`);
        const recorded = await commerce.recordPaymentEvent(
          Buffer.from(JSON.stringify({ event: "charge.success", data: { id, reference } })),
        );
        return { id, key: `test:charge.success:${id}`, recorded };
      };
      const events = (keys: string[]) =>
        db.select().from(valoPaymentEvents).where(inArray(valoPaymentEvents.eventKey, keys));
      // PAY-004 and NFR-009: "invalid, replayed and duplicate events cannot create a new purchase";
      // "bounded retriable jobs". The worker takes every pending event in the database, so it runs
      // until none of this subtest's events is pending, and other tests' events fail their check.
      await t.test(
        "with a test merchant, the event worker checks a recorded charge with Paystack on the server and settles it once, sends an unmatched reference to review at once, and stops retrying a charge it cannot check after five attempts",
        async () => {
          const paid = await fixture(),
            unverifiable = await fixture();
          const settled = response(paid);
          await withStandInMerchant(new Map([[paid!.reference, settled]]), async (verified) => {
            const good = await charge(paid!.reference),
              unmatched = await charge(`valo-test-unmatched-${randomUUID()}`),
              failing = await charge(unverifiable!.reference);
            assert.equal(good.recorded.duplicate, false);
            // The same delivery again is recorded once.
            const replay = await commerce.recordPaymentEvent(
              Buffer.from(
                JSON.stringify({
                  event: "charge.success",
                  data: { id: good.id, reference: paid!.reference },
                }),
              ),
            );
            assert.equal(replay.duplicate, true);
            const mine = [good.key, unmatched.key, failing.key];
            for (let run = 0; run < 12; run++) {
              await commerce.processPaymentEvents();
              if ((await events(mine)).every((e) => e.status !== "pending")) break;
            }
            const byKey = new Map((await events(mine)).map((e) => [e.eventKey, e]));
            assert.deepEqual(
              { status: byKey.get(good.key)!.status, failure: byKey.get(good.key)!.failure },
              { status: "processed", failure: null },
            );
            assert.deepEqual(
              { status: byKey.get(unmatched.key)!.status, attempts: byKey.get(unmatched.key)!.attempts },
              { status: "needs_review", attempts: 1 },
            );
            assert.deepEqual(
              { status: byKey.get(failing.key)!.status, attempts: byKey.get(failing.key)!.attempts },
              { status: "needs_review", attempts: 5 },
            );
            // Each attempt asked Paystack once; the settled charge was not asked again.
            assert.equal(verified.filter((r) => r === paid!.reference).length, 1);
            assert.equal(verified.filter((r) => r === unverifiable!.reference).length, 5);
            const [order] = await db.select().from(valoOrders).where(eq(valoOrders.id, paid!.id));
            assert.deepEqual(
              { status: order!.status, providerTransactionId: order!.providerTransactionId },
              { status: "verified_success", providerTransactionId: settled.id },
            );
            const grants = await db
              .select()
              .from(valoEntitlements)
              .where(inArray(valoEntitlements.orderId, [paid!.id, unverifiable!.id]));
            assert.deepEqual(
              grants.map((g) => [g.orderId, g.status]),
              [[paid!.id, "active"]],
            );
            const [still] = await db.select().from(valoOrders).where(eq(valoOrders.id, unverifiable!.id));
            assert.notEqual(still!.status, "verified_success");
          });
        },
      );
      await t.test(
        "two event workers at once settle a charge once: one purchase, one grant, one receipt to send and one settlement in the audit trail",
        async () => {
          const paid = await fixture();
          await withStandInMerchant(new Map([[paid!.reference, response(paid)]]), async () => {
            const good = await charge(paid!.reference);
            for (let run = 0; run < 12; run++) {
              await Promise.all([commerce.processPaymentEvents(), commerce.processPaymentEvents()]);
              if ((await events([good.key])).every((e) => e.status !== "pending")) break;
            }
            assert.equal((await events([good.key]))[0]!.status, "processed");
            const grants = await db
              .select()
              .from(valoEntitlements)
              .where(eq(valoEntitlements.orderId, paid!.id));
            const receipts = await db
              .select()
              .from(valoPurchaseOutbox)
              .where(eq(valoPurchaseOutbox.orderId, paid!.id));
            const settledEvents = await db
              .select()
              .from(valoEvents)
              .where(
                and(eq(valoEvents.entityId, paid!.id), eq(valoEvents.action, "payment.verified_success")),
              );
            assert.deepEqual([grants.length, receipts.length, settledEvents.length], [1, 1, 1]);
          });
        },
      );
      // PAY-006: "interrupted browser sessions recover their purchase without requiring an unnecessary
      // second payment". The customer paid on Paystack's page and never came back to Valo.
      await t.test(
        "a status refresh checks an interrupted payment with Paystack on the server and recovers the purchase, and the order then refuses a second payment",
        async () => {
          const paid = await fixture();
          await db.update(valoOrders).set({ status: "pending" }).where(eq(valoOrders.id, paid!.id));
          await withStandInMerchant(new Map([[paid!.reference, response(paid)]]), async (verified) => {
            const recovered = await commerce.refreshOrder(a, paid!.id);
            assert.equal(recovered.status, "verified_success");
            assert.deepEqual(verified, [paid!.reference]);
            const grants = await db
              .select()
              .from(valoEntitlements)
              .where(eq(valoEntitlements.orderId, paid!.id));
            assert.deepEqual(
              grants.map((g) => g.status),
              ["active"],
            );
            await assert.rejects(commerce.startCheckout(a, paid!.id, "synthetic-buyer@example.invalid"), {
              status: 409,
              message: "This purchase is already verified. Do not pay again.",
            });
            // A second refresh changes nothing.
            assert.equal((await commerce.refreshOrder(a, paid!.id)).status, "verified_success");
            assert.equal(
              (await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, paid!.id))).length,
              1,
            );
          });
        },
      );
      console.log(
        JSON.stringify({
          scope: "Controlled database payment mechanics, not Paystack execution",
          realProviderCalls: 0,
          publishedFixtures: 0,
          priceApproval: false,
          livePayments: false,
        }),
      );
      await t.test(
        "an order keeps the offer, the line and the amount it was made with, whoever asks to change them, and still takes what happens to it",
        async () => {
          // PAY-001: the database keeps an order's terms. A change that reaches the row is refused by
          // either route to it: the application's own login, and the role a customer's request acts as,
          // which both hold the privilege to update an order.
          const kept = await fixture();
          const message = (error: Error) =>
            String((error as { cause?: Error }).cause?.message ?? error.message);
          const keepsTerms = (error: Error) =>
            /An order keeps the offer, the line and the amount it was made with/.test(message(error));
          const keepsWho = (error: Error) =>
            /An order keeps who placed it, until an erasure removes them/.test(message(error));
          const stored = async (id: string) =>
            (await db.select().from(valoOrders).where(eq(valoOrders.id, id)))[0];
          const inScope = <T>(run: () => Promise<T>) => runInWorkspaceScope(a.workspaceId, run);
          const changes: Record<string, Partial<typeof valoOrders.$inferInsert>> = {
            "its amount": { amountKobo: 1 },
            "its currency": { currency: "USD" },
            "its line": { line: { ...fixtureLine, title: "CONTROLLED TEST ONLY: another product" } },
            "its price": { priceId: randomUUID() },
            "a bundle in place of its price": { priceId: null, bundleId: randomUUID() },
            // The table's own check would refuse this one too, with other words: the guard's come first.
            "a bundle beside its price": { bundleId: randomUUID() },
            "its workspace": { workspaceId: b.workspaceId },
            "its reference": { reference: `valo-test-${randomUUID()}` },
            "its request key": { requestKey: randomUUID() },
            "the time it was made": { createdAt: new Date(0) },
            "its own number": { id: randomUUID() },
          };
          for (const [what, change] of Object.entries(changes)) {
            await assert.rejects(
              db.update(valoOrders).set(change).where(eq(valoOrders.id, kept!.id)),
              keepsTerms,
              `the application's login changed ${what}`,
            );
            await assert.rejects(
              inScope(async () => await db.update(valoOrders).set(change).where(eq(valoOrders.id, kept!.id))),
              keepsTerms,
              `a customer's request changed ${what}`,
            );
          }
          // A change to several columns at once is refused when one of them is kept.
          await assert.rejects(
            db
              .update(valoOrders)
              .set({ status: "pending", amountKobo: 1 })
              .where(eq(valoOrders.id, kept!.id)),
            keepsTerms,
          );
          assert.deepEqual(await stored(kept!.id), kept);
          // What happens to an order still changes, by both routes.
          const checked = new Date(Math.floor(Date.now() / 1000) * 1000),
            checkoutUrl = "https://checkout.example.test/synthetic",
            providerTransactionId = `synthetic-${randomUUID()}`;
          await inScope(async () => {
            await db
              .update(valoOrders)
              .set({ status: "pending", checkoutUrl, lastCheckedAt: checked })
              .where(eq(valoOrders.id, kept!.id));
          });
          await db
            .update(valoOrders)
            .set({ status: "needs_review", providerTransactionId })
            .where(eq(valoOrders.id, kept!.id));
          assert.deepEqual(await stored(kept!.id), {
            ...kept,
            status: "needs_review",
            checkoutUrl,
            lastCheckedAt: checked,
            providerTransactionId,
          });
          // Who placed an order changes once, to the mark an erasure leaves in their place. The
          // erasure's own statement does that, to a workspace made for it, and nothing else is put there.
          const leaving = await resolveWorkspace(`synthetic-commerce-${randomUUID()}`);
          workspaces.push(leaving.workspaceId);
          const theirs = await fixture(leaving);
          for (const requestedBy of [a.identityId, "", "privacy-erased-by-hand"])
            await assert.rejects(
              db.update(valoOrders).set({ requestedBy }).where(eq(valoOrders.id, theirs!.id)),
              keepsWho,
              `who placed the order became "${requestedBy}"`,
            );
          await db.transaction((tx) =>
            erasePrivateCopyPhase(tx, leaving.workspaceId, "financial_contact", async () => undefined),
          );
          assert.deepEqual(await stored(theirs!.id), { ...theirs, requestedBy: "privacy-erased" });
          await assert.rejects(
            db
              .update(valoOrders)
              .set({ requestedBy: leaving.identityId })
              .where(eq(valoOrders.id, theirs!.id)),
            keepsWho,
          );
          await assert.rejects(
            db
              .update(valoOrders)
              .set({ requestedBy: "privacy-erased", amountKobo: 1 })
              .where(eq(valoOrders.id, theirs!.id)),
            keepsTerms,
          );
        },
      );
      await t.test(
        "a new order is refused unless it names a price in effect and has that price's amount, currency and whole line, whoever makes it",
        async () => {
          // PAY-001: the database checks a new order against the price book. A row that names a price is
          // made only while that price is in effect, and only with the price's own amount, currency and
          // line, by either route to the table: the application's own login, and the role a customer's
          // request acts as, which both hold the privilege to insert an order.
          assert.ok(offer);
          const terms = priceOrderTerms(offer);
          const message = (error: Error) =>
            String((error as { cause?: Error }).cause?.message ?? error.message);
          const notThePrices = (error: Error) =>
            /An order is made with the amount and the line its price gives/.test(message(error));
          const notInEffect = (error: Error) =>
            /An order is made from a price in effect/.test(message(error));
          const inScope = <T>(run: () => Promise<T>) => runInWorkspaceScope(a.workspaceId, run);
          const tried: string[] = [];
          const make = (change: Record<string, unknown> = {}) => {
            const id = randomUUID();
            tried.push(id);
            return db.insert(valoOrders).values({
              id,
              workspaceId: a.workspaceId,
              requestedBy: a.identityId,
              requestKey: randomUUID(),
              reference: `valo-test-${id}`,
              ...terms,
              ...(change as Partial<typeof valoOrders.$inferInsert>),
            });
          };
          const { taxTreatment: _left, ...withoutTax } = terms.line;
          const wrong: Record<string, Record<string, unknown>> = {
            "a kobo less": { amountKobo: terms.amountKobo - 1 },
            "a kobo more": { amountKobo: terms.amountKobo + 1 },
            // The table's own check would refuse this one too, with other words: the guard's come first.
            "another currency": { currency: "USD" },
            "another title": { line: { ...terms.line, title: "CONTROLLED TEST ONLY: another product" } },
            "another edition": { line: { ...terms.line, contentVersionId: randomUUID() } },
            "another licence version": { line: { ...terms.line, licenceVersion: "controlled-not-approved" } },
            "another licence text": { line: { ...terms.line, licenceText: "Other terms." } },
            "another tax treatment": { line: { ...terms.line, taxTreatment: "Tax included." } },
            "a discount in its line": { line: { ...terms.line, discountKobo: 1 } },
            "a line without its tax treatment": { line: withoutTax },
            "an empty line": { line: {} },
          };
          for (const [what, change] of Object.entries(wrong)) {
            await assert.rejects(
              make(change),
              notThePrices,
              `the application's login made an order with ${what}`,
            );
            await assert.rejects(
              inScope(async () => await make(change)),
              notThePrices,
              `a customer's request made an order with ${what}`,
            );
          }
          // A price that has closed, one that has not begun and one that does not exist are none of them in
          // effect. The first price was closed by an earlier subtest.
          const [closed] = await db.select().from(valoPrices).where(eq(valoPrices.id, priceId));
          assert.ok(closed?.effectiveTo, "the first price has closed");
          const [later] = await db
            .insert(valoPrices)
            .values({
              id: randomUUID(),
              contentVersionId: version,
              title: fixtureLine.title,
              amountKobo: 77777,
              licenceVersion: "controlled-not-approved-v3",
              licenceText: "A test price that has not begun",
              taxTreatment: fixtureLine.taxTreatment,
              approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
              effectiveFrom: new Date(Date.now() + 86_400_000),
            })
            .returning();
          assert.ok(later);
          const elsewhere: Record<string, Record<string, unknown>> = {
            "a price that has closed": priceOrderTerms(closed),
            "a price that has not begun": priceOrderTerms(later),
            "a price that does not exist": { priceId: randomUUID() },
          };
          for (const [what, from] of Object.entries(elsewhere)) {
            await assert.rejects(
              make(from),
              notInEffect,
              `the application's login made an order from ${what}`,
            );
            await assert.rejects(
              inScope(async () => await make(from)),
              notInEffect,
              `a customer's request made an order from ${what}`,
            );
          }
          // Nothing of all that was saved.
          assert.deepEqual(
            await db.select({ id: valoOrders.id }).from(valoOrders).where(inArray(valoOrders.id, tried)),
            [],
          );
          // With exactly its price's terms an order is made, by both routes.
          const before = tried.length;
          await make();
          await inScope(async () => await make());
          const saved = await db
            .select()
            .from(valoOrders)
            .where(inArray(valoOrders.id, tried.slice(before)));
          assert.equal(saved.length, 2);
          for (const row of saved)
            assert.deepEqual(
              { priceId: row.priceId, amountKobo: row.amountKobo, currency: row.currency, line: row.line },
              terms,
            );
          orders.push(...tried.slice(before));
        },
      );
      await t.test(
        "the look for a workspace's ended orders keeps to that workspace, the editions asked about, the two endings and the orders the provider was offered, the five latest first, on a login that sees every workspace's orders",
        async () => {
          // PAY-006: before another order or payment, the provider is asked again about these orders. A
          // customer's request sees only its own workspace's rows, so no request can show whether the
          // look's own conditions are there. Here it runs on the application's own login, which sees
          // every workspace's orders.
          const asking = await resolveWorkspace(`synthetic-commerce-${randomUUID()}`),
            neighbour = await resolveWorkspace(`synthetic-commerce-${randomUUID()}`);
          workspaces.push(asking.workspaceId, neighbour.workspaceId);
          const started = Date.now(),
            page = "https://checkout.example.test/synthetic",
            taken = () => `synthetic-${randomUUID()}`;
          // Another edition, with a price of its own: an order is made from its own edition's price.
          const other = await freshHeldFixture(),
            otherEdition = other.id;
          const [current, elsewherePrice] = [
            offer,
            (
              await db
                .insert(valoPrices)
                .values({
                  id: randomUUID(),
                  contentVersionId: otherEdition,
                  title: "CONTROLLED TEST ONLY — another edition, not a released product",
                  amountKobo: 54321,
                  licenceVersion: fixtureLine.licenceVersion,
                  licenceText: fixtureLine.licenceText,
                  taxTreatment: fixtureLine.taxTreatment,
                  approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
                  effectiveFrom: new Date(started - 1000),
                })
                .returning()
            )[0],
          ];
          assert.ok(current && elsewherePrice);
          const earlier = async (
            actor: typeof a,
            minutesAgo: number,
            happened: Partial<typeof valoOrders.$inferInsert>,
            from = current,
          ) => {
            const id = randomUUID();
            orders.push(id);
            await db.insert(valoOrders).values({
              id,
              workspaceId: actor.workspaceId,
              requestedBy: actor.identityId,
              requestKey: randomUUID(),
              reference: `valo-test-${id}`,
              ...priceOrderTerms(from),
              createdAt: new Date(started - minutesAgo * 60_000),
            });
            await db.update(valoOrders).set(happened).where(eq(valoOrders.id, id));
            return id;
          };
          const look = (actor: typeof a, editions: string[]) =>
            db.transaction((tx) => endedEditionOrders(tx, actor, editions));
          const abandoned = await earlier(asking, 90, { status: "abandoned", checkoutUrl: page }),
            failed = await earlier(asking, 80, { status: "failed", providerTransactionId: taken() });
          // Not asked about: an order the provider was never offered, and one that has not ended so.
          await earlier(asking, 70, { status: "abandoned" });
          await earlier(asking, 69, { status: "failed" });
          for (const status of ["created", "pending", "verified_success", "needs_review", "reversed"])
            await earlier(asking, 60, { status, checkoutUrl: page, providerTransactionId: taken() });
          const elsewhere = await earlier(
            asking,
            50,
            { status: "abandoned", checkoutUrl: page },
            elsewherePrice,
          );
          const theirs = await earlier(neighbour, 40, { status: "failed", checkoutUrl: page });
          assert.deepEqual(await look(asking, [version]), [failed, abandoned]);
          assert.deepEqual(await look(neighbour, [version]), [theirs]);
          assert.deepEqual(await look(asking, [otherEdition]), [elsewhere]);
          assert.deepEqual(await look(neighbour, [otherEdition]), []);
          assert.deepEqual(await look(asking, [otherEdition, version]), [elsewhere, failed, abandoned]);
          assert.deepEqual(await look(asking, [randomUUID()]), []);
          assert.deepEqual(await look(asking, []), []);
          // Five at most, the latest first: the neighbour's earliest of six is left to the day's
          // reconciliation.
          const later: string[] = [];
          for (const minutesAgo of [30, 25, 20, 15, 10])
            later.unshift(await earlier(neighbour, minutesAgo, { status: "abandoned", checkoutUrl: page }));
          assert.deepEqual(await look(neighbour, [version]), later);
          assert.ok(!later.includes(theirs));
          // The asking workspace's answer is what it was.
          assert.deepEqual(await look(asking, [version]), [failed, abandoned]);
        },
      );
      await t.test("checkout of a product that is not released is refused", async () => {
        const order = await fixture();
        await assert.rejects(commerce.startCheckout(a, order!.id, "synthetic@example.test"), {
          status: 409,
          message: /unavailable for new checkout/,
        });
      });
      await t.test("no commerce call takes a second pooled connection inside a transaction", () => {
        assert.deepEqual(guard.violations, []);
      });
      await t.test(
        "purchase listings beyond the database pool size all finish",
        { timeout: 20000 },
        async () => {
          // Each listing used to read the catalogue on a second connection while its
          // transaction held one, so ten at once exhausted the pool and none finished.
          const n = 25;
          assert.ok(n > (pool.options.max ?? 10));
          const listings = await Promise.all(Array.from({ length: n }, () => commerce.purchases(a)));
          assert.equal(listings.length, n);
        },
      );
    } finally {
      guard.restore();
      await db
        .delete(valoPaymentEvents)
        .where(inArray(valoPaymentEvents.eventKey, eventKeys.length ? eventKeys : ["none"]));
      // Retain immutable synthetic financial history and FK parents. No trigger
      // is disabled to make cleanup or a test pass.
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, workspaces));
      await pool.end();
    }
  },
);
