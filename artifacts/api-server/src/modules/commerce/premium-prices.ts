import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { premiumEditions, type PremiumEdition } from "./premium-editions";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A premium template's price, recorded for the product owner (step 5 of the content and speed plan
 * in docs/architecture/plan.md). Only the owner decides a price's amount, licence and tax treatment,
 * so a price is recorded only with their approval reference and the checksum of the exact terms they
 * approved. A price row's terms never change: recording a new price closes the template's open price
 * at the moment the new one starts, once (ADM-006, migration price_change_log). Checkout still runs
 * only with a test key in development; recording a price takes no payment.
 *
 * Only a published premium template from the staff library (decision 0018) can be priced here.
 */

/** ₦10,000,000: a figure above it is far more likely a typing error than a template's price. */
export const PREMIUM_PRICE_LIMIT_KOBO = 1_000_000_000;

export type PremiumPriceTerms = {
  /** The published edition's ID: the staff library version a buyer receives. */
  edition: string;
  amountKobo: number;
  licenceVersion: string;
  licenceText: string;
  taxTreatment: string;
  /** "now", or an ISO 8601 time with its offset. */
  from: string;
};

const oneLine = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && !/[\r\n\t]/.test(value);

/** An amount in naira, as the owner writes it ("1500" or "1500.00"), in kobo. */
export function nairaToKobo(text: string): number {
  if (!/^\d{1,8}(?:\.\d{2})?$/.test(text))
    throw Error("Write the amount in naira, such as 1500 or 1500.00, without commas or ₦.");
  const [whole, fraction = "00"] = text.split(".");
  const kobo = Number(whole) * 100 + Number(fraction);
  if (kobo <= 0 || kobo > PREMIUM_PRICE_LIMIT_KOBO)
    throw Error("A price is more than ₦0 and at most ₦10,000,000.");
  return kobo;
}

/** The terms as the command was given them, checked. Nothing is read or written. */
export function premiumPriceTerms(input: {
  edition: string | undefined;
  amount: string | undefined;
  licenceVersion: string | undefined;
  licenceText: string | undefined;
  taxTreatment: string | undefined;
  from?: string | undefined;
}): PremiumPriceTerms {
  const edition = input.edition ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(edition))
    throw Error("Give the edition ID that status lists for the template.");
  const licenceVersion = input.licenceVersion ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(licenceVersion))
    throw Error("Give a licence version of letters, digits, dots, dashes or underscores, such as premium-1.");
  const licenceText = (input.licenceText ?? "").trim();
  if (licenceText.length < 20 || licenceText.length > 20000)
    throw Error("The licence text is 20 to 20,000 characters, read from its file.");
  const taxTreatment = (input.taxTreatment ?? "").trim();
  if (!oneLine(taxTreatment, 3, 300))
    throw Error("Give the tax treatment on one line, in 3 to 300 characters.");
  const from = input.from ?? "now";
  if (
    from !== "now" &&
    !(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(from) &&
      Number.isFinite(Date.parse(from))
    )
  )
    throw Error("Give the start as now, or as a time with its offset, such as 2026-12-01T00:00:00+01:00.");
  return {
    edition,
    amountKobo: nairaToKobo(input.amount ?? ""),
    licenceVersion,
    licenceText,
    taxTreatment,
    from,
  };
}

/** The checksum the owner confirms: of the exact terms, so a changed figure or word needs a new
 * confirmation. */
export function premiumPriceTermsId(terms: PremiumPriceTerms) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "valo-premium-price-v1",
        terms.edition,
        terms.amountKobo,
        terms.licenceVersion,
        terms.licenceText,
        terms.taxTreatment,
        terms.from,
      ]),
    )
    .digest("hex");
}

/** The published premium templates from the staff library, each with its current and later prices.
 * Read-only. */
export async function premiumPriceStatus() {
  const { db, valoManualLibrary, valoPrices } = await import("@workspace/db");
  const t = valoManualLibrary;
  const editions = await db
    .select({
      edition: t.id,
      itemId: t.itemId,
      version: t.version,
      title: t.title,
      publishedAt: t.publishedAt,
    })
    .from(t)
    .where(and(eq(t.kind, "premium_template"), eq(t.state, "published")))
    .orderBy(asc(t.title), asc(t.id));
  const p = valoPrices;
  const prices = editions.length
    ? await db
        .select({
          priceId: p.id,
          edition: p.contentVersionId,
          amountKobo: p.amountKobo,
          licenceVersion: p.licenceVersion,
          taxTreatment: p.taxTreatment,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo,
        })
        .from(p)
        .where(
          and(
            inArray(
              p.contentVersionId,
              editions.map((e) => e.edition),
            ),
            or(isNull(p.effectiveTo), gt(p.effectiveTo, sql`now()`)),
          ),
        )
        .orderBy(asc(p.effectiveFrom), asc(p.id))
    : [];
  return editions.map((e) => ({
    ...e,
    prices: prices.filter((price) => price.edition === e.edition).map(({ edition: _e, ...price }) => price),
  }));
}

/**
 * Records the owner's price for a published premium template, and closes the template's open price
 * when the new one starts. Refused unless `confirm` is the checksum of exactly these terms.
 */
export async function recordPremiumPrice(terms: PremiumPriceTerms, approval: PremiumPriceApproval) {
  const { db: store } = await import("@workspace/db");
  return store.transaction((tx) => recordPremiumPriceIn(tx, terms, approval));
}

export type PremiumPriceApproval = { approvedBy: string; reference: string; confirm: string };

/** The same in the caller's transaction, which nothing else in it may have used for prices yet. */
export async function recordPremiumPriceIn(tx: Tx, terms: PremiumPriceTerms, approval: PremiumPriceApproval) {
  if (approval.confirm !== premiumPriceTermsId(terms))
    throw Error("The confirmation is not the checksum of these terms. Preview them again and confirm that.");
  const approvedBy = approval.approvedBy.trim(),
    reference = approval.reference.trim();
  if (!oneLine(approvedBy, 2, 120)) throw Error("Name who approved the price, on one line.");
  if (!oneLine(reference, 3, 160)) throw Error("Say where the approval is written, on one line.");
  const { valoManualLibrary, valoPrices } = await import("@workspace/db");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"premium-price:" + terms.edition}, 0))`,
  );
  const { rows: live } = await tx.execute<PremiumEdition>(premiumEditions(terms.edition));
  if (!live[0] || live[0].held)
    throw Error(
      "Only a published premium template from the staff library, not overdue for its review and not held by staff, can be priced. Check its edition ID and review date with status, and any hold in the staff library.",
    );
  const [entry] = await tx
    .select({ title: valoManualLibrary.title })
    .from(valoManualLibrary)
    .where(eq(valoManualLibrary.id, terms.edition));
  const { rows } = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
  const now = new Date(rows[0]!.now);
  const from = terms.from === "now" ? now : new Date(terms.from);
  if (+from < +now)
    throw Error("This price would start in the past. Preview it again with now or a later start.");
  // A price that starts now starts at the transaction's own time, as the database holds it: a copy
  // read back keeps only milliseconds, and closing a price a fraction before now() is refused.
  const start = terms.from === "now" ? sql`now()` : from;
  const p = valoPrices;
  const open = await tx
    .select()
    .from(p)
    .where(and(eq(p.contentVersionId, terms.edition), or(isNull(p.effectiveTo), gt(p.effectiveTo, start))))
    .orderBy(asc(p.effectiveFrom), asc(p.id))
    .for("update");
  const scheduled = open.find((price) => +price.effectiveFrom >= +from);
  if (scheduled)
    throw Error(
      `A price for this template already starts at ${scheduled.effectiveFrom.toISOString()}. Start the new one after it.`,
    );
  const ending = open.find((price) => price.effectiveTo !== null);
  if (ending)
    throw Error(
      `This template's price already ends at ${ending.effectiveTo!.toISOString()}. Start the new one then or later.`,
    );
  for (const price of open) await tx.update(p).set({ effectiveTo: start }).where(eq(p.id, price.id));
  const priceId = randomUUID();
  const [recorded] = await tx
    .insert(p)
    .values({
      id: priceId,
      contentVersionId: terms.edition,
      title: entry!.title,
      amountKobo: terms.amountKobo,
      currency: "NGN",
      licenceVersion: terms.licenceVersion,
      licenceText: terms.licenceText,
      taxTreatment: terms.taxTreatment,
      approvalReference: `${reference} (approved by ${approvedBy})`,
      effectiveFrom: start,
    })
    .returning({ effectiveFrom: p.effectiveFrom });
  return {
    priceId,
    edition: terms.edition,
    title: entry!.title,
    amountKobo: terms.amountKobo,
    from: recorded!.effectiveFrom,
    closed: open.map((price) => ({ priceId: price.id, amountKobo: price.amountKobo })),
  };
}
