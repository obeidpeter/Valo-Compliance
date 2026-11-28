import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, valoOrders, valoPaymentEvents, valoPaymentLists } from "@workspace/db";
import { paystack, sandboxPaymentsConfigured, type ListedTransactions } from "./valo-paystack-contract";
import { reconcilePayments } from "./valo-payment-reconciliation";

/** How long a day's list that could not be read is left alone before it is asked for again. */
export const LISTING_RETRY_MINUTES = 60;
/** How many attempts a day's list has before it waits for finance. */
export const LISTING_ATTEMPTS = 3;
/** How many pages of a day's list are read. A longer list is read that far, and waits for finance. */
export const LISTING_PAGES = 20;
/** How many days back a day the worker did not record is still recorded, when it runs again. */
export const LISTING_CATCH_UP_DAYS = 31;

/** The UTC day before `now`, as YYYY-MM-DD: the last day that has ended. */
export function previousUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
}

/** The key of the event a day's own list leaves for finance. No event Paystack sends has a key like it. */
export function listingEventKey(day: string) {
  return `listing:test:${day}`;
}

/** A provider event that waits for finance, for what a day's list holds or could not give. */
function waiting(key: string, eventType: string, reference: string, finding: string) {
  return {
    id: randomUUID(),
    eventKey: key,
    bodyHash: createHash("sha256").update(`${key}\n${finding}`).digest("hex"),
    eventType,
    reference,
    status: "needs_review",
    attempts: 0,
    failure: finding,
  };
}

/** Records each day of the last `LISTING_CATCH_UP_DAYS` that has ended and is not recorded yet, from the
 * first day ever recorded: a day the worker did not run on is listed when it runs again. The first run
 * records the day before alone. */
async function recordEndedDays(last: string) {
  await db.execute(sql`INSERT INTO valo_payment_lists (day)
    SELECT to_char(${last}::date - back, 'YYYY-MM-DD')
    FROM generate_series(0, ${LISTING_CATCH_UP_DAYS - 1}::int) AS back
    WHERE ${last}::date - back >= coalesce((SELECT min(day)::date FROM valo_payment_lists), ${last}::date)
    ON CONFLICT (day) DO NOTHING`);
}

/**
 * Reads Paystack's own list of the successful payments of a day that has ended
 * (docs/architecture/reconciliation.md, slice 3b), the earliest that is due. A payment on it whose
 * reference is no order's is recorded as a provider event that waits for finance, `UNMATCHED_REFERENCE`, with
 * the key the webhook would give it: one Paystack sends both ways is recorded once. A day is listed once. A
 * list that cannot be read is asked for again an hour later, three times in all, and then waits for finance
 * as `LISTING_UNREAD`; one longer than twenty pages is read that far, and waits as `LISTING_INCOMPLETE`.
 * Paystack is asked outside any transaction, and nothing about an order, a payment or a grant changes.
 */
export async function listProviderTransactions(now = new Date()) {
  if (!sandboxPaymentsConfigured()) return null;
  const last = previousUtcDay(now);
  await recordEndedDays(last);
  // A day is listed only once it has ended, so its list is whole.
  const [due] = await db
    .select()
    .from(valoPaymentLists)
    .where(
      and(
        eq(valoPaymentLists.status, "pending"),
        lte(valoPaymentLists.day, last),
        or(
          isNull(valoPaymentLists.lastAttemptAt),
          lte(valoPaymentLists.lastAttemptAt, sql`now() - ${LISTING_RETRY_MINUTES} * interval '1 minute'`),
        ),
      ),
    )
    .orderBy(asc(valoPaymentLists.day))
    .limit(1);
  if (!due) return null;
  const pages: ListedTransactions[] = [];
  let pageCount = 0;
  try {
    const first = await paystack.listSuccessful(due.day, 1);
    pages.push(first);
    pageCount = first.meta.pageCount;
    for (let page = 2; page <= Math.min(pageCount, LISTING_PAGES); page++)
      pages.push(await paystack.listSuccessful(due.day, page));
  } catch {
    // No answer that could be used: the attempt is counted and timed, and the third leaves the day for
    // finance. The reason stays out of the record: it may hold the provider's own words. An attempt another
    // worker counted while this one waited is not counted again.
    const counted = await db.transaction(async (tx) => {
      const [row] = await tx
        .execute<{ status: string; attempts: number }>(
          sql`UPDATE valo_payment_lists SET attempts = attempts + 1, last_attempt_at = now(),
            status = CASE WHEN attempts + 1 >= ${LISTING_ATTEMPTS} THEN 'needs_review' ELSE 'pending' END,
            finding = CASE WHEN attempts + 1 >= ${LISTING_ATTEMPTS} THEN 'LISTING_UNREAD' ELSE finding END
          WHERE day = ${due.day} AND status = 'pending' AND attempts = ${due.attempts}
          RETURNING status, attempts`,
        )
        .then((result) => result.rows);
      if (row?.status === "needs_review")
        await tx
          .insert(valoPaymentEvents)
          .values(waiting(listingEventKey(due.day), "listing", due.day, "LISTING_UNREAD"))
          .onConflictDoNothing();
      return row ?? null;
    });
    // `attempts` is null when another worker counted the attempt meanwhile.
    return { day: due.day, read: false, attempts: counted ? counted.attempts : null };
  }
  const whole = pageCount <= LISTING_PAGES;
  const paid = pages.flatMap((page) => page.data).filter((transaction) => transaction.status === "success");
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select({ day: valoPaymentLists.day })
      .from(valoPaymentLists)
      .where(and(eq(valoPaymentLists.day, due.day), eq(valoPaymentLists.status, "pending")))
      .for("update");
    // Another worker finished this day while the list was read.
    if (!open) return null;
    const references = [...new Set(paid.map((transaction) => transaction.reference))];
    const known = new Set(
      references.length
        ? (
            await tx
              .select({ reference: valoOrders.reference })
              .from(valoOrders)
              .where(inArray(valoOrders.reference, references))
          ).map((row) => row.reference)
        : [],
    );
    const unmatched = [
      ...new Map(
        paid
          .filter((transaction) => !known.has(transaction.reference))
          .map((transaction) => [transaction.id, transaction]),
      ).values(),
    ];
    for (const transaction of unmatched)
      await tx
        .insert(valoPaymentEvents)
        .values(
          waiting(
            `test:charge.success:${transaction.id}`,
            "charge.success",
            transaction.reference,
            "UNMATCHED_REFERENCE",
          ),
        )
        .onConflictDoNothing();
    if (!whole)
      await tx
        .insert(valoPaymentEvents)
        .values(waiting(listingEventKey(due.day), "listing", due.day, "LISTING_INCOMPLETE"))
        .onConflictDoNothing();
    await tx
      .update(valoPaymentLists)
      .set({
        status: whole ? "listed" : "needs_review",
        finding: whole ? null : "LISTING_INCOMPLETE",
        attempts: sql`LEAST(${valoPaymentLists.attempts} + 1, ${LISTING_ATTEMPTS})`,
        lastAttemptAt: sql`now()`,
        pages: pages.length,
        transactions: paid.length,
        unmatched: unmatched.length,
        finishedAt: sql`now()`,
      })
      .where(eq(valoPaymentLists.day, due.day));
    return {
      day: due.day,
      read: true,
      whole,
      pages: pages.length,
      transactions: paid.length,
      unmatched: unmatched.length,
    };
  });
}

/**
 * The worker's `paymentReconciliation` task, each minute (docs/architecture/reconciliation.md, slices 1 and
 * 3b): the daily checks of Valo's own orders, and the reading of Paystack's own list of a day that has ended.
 * Each runs whatever became of the other, and the task fails if either did. `parts` lets a test fail one.
 */
export async function runPaymentReconciliationJob(
  now = new Date(),
  parts: { check: typeof reconcilePayments; list: typeof listProviderTransactions } = {
    check: reconcilePayments,
    list: listProviderTransactions,
  },
) {
  const failures: unknown[] = [];
  const keep = (error: unknown) => {
    failures.push(error);
    return null;
  };
  const checked = await parts.check().catch(keep);
  const listed = await parts.list(now).catch(keep);
  if (failures.length) throw new AggregateError(failures, "PAYMENT_RECONCILIATION_PARTIALLY_FAILED");
  return { checked, listed };
}
