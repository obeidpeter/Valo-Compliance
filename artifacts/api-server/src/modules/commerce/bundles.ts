import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { nairaToKobo } from "./premium-prices";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A bundle's versions (docs/architecture/commercial-settings.md, slice 4b; ADM-006): a named, curated set of
 * the staff library's premium templates, sold once at one price. Only the product owner decides a bundle,
 * its templates, amount, licence and tax treatment, so a version is recorded only with their approval
 * reference and the checksum of the exact terms they approved. A version never changes in place: the next
 * one closes it when it starts, once, and the change log keeps both (migration bundle_guards). Recording a
 * bundle takes no payment, and checkout does not offer bundles yet.
 */

/** Why a template cannot be in a bundle. */
export const NOT_BUNDLEABLE =
  "A bundle holds only premium templates from the staff library that have been released. Check each template you chose.";

export const BUNDLE_SIZE = { min: 2, max: 10 } as const;

export type BundleTerms = {
  /** The bundle's name across its versions: lower-case letters, digits and dashes. */
  bundle: string;
  title: string;
  /** The staff library items it holds, each a premium template, in order of their IDs. */
  items: string[];
  amountKobo: number;
  licenceVersion: string;
  licenceText: string;
  taxTreatment: string;
  /** "now", or an ISO 8601 time with its offset. */
  from: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const oneLine = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && !/[\r\n\t]/.test(value);

/** The terms as the owner gave them, checked. Nothing is read or written. */
export function bundleTerms(input: {
  bundle: string | undefined;
  title: string | undefined;
  items: readonly string[] | undefined;
  amount: string | undefined;
  licenceVersion: string | undefined;
  licenceText: string | undefined;
  taxTreatment: string | undefined;
  from?: string | undefined;
}): BundleTerms {
  const bundle = input.bundle ?? "";
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bundle))
    throw new ValoProblem(
      422,
      "Name the bundle in lower-case letters, digits and dashes, such as starter-pack, in 2 to 63 characters.",
    );
  const title = (input.title ?? "").trim();
  if (!oneLine(title, 3, 120))
    throw new ValoProblem(422, "Give the bundle a title on one line, in 3 to 120 characters.");
  const items = [...(input.items ?? [])];
  if (items.length < BUNDLE_SIZE.min || items.length > BUNDLE_SIZE.max)
    throw new ValoProblem(422, `A bundle holds ${BUNDLE_SIZE.min} to ${BUNDLE_SIZE.max} templates.`);
  if (!items.every((item) => UUID.test(item))) throw new ValoProblem(422, NOT_BUNDLEABLE);
  if (new Set(items).size !== items.length) throw new ValoProblem(422, "A bundle holds each template once.");
  const licenceVersion = input.licenceVersion ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(licenceVersion))
    throw new ValoProblem(
      422,
      "Give a licence version of letters, digits, dots, dashes or underscores, such as bundle-1.",
    );
  const licenceText = (input.licenceText ?? "").trim();
  if (licenceText.length < 20 || licenceText.length > 20000)
    throw new ValoProblem(422, "The licence text is 20 to 20,000 characters.");
  const taxTreatment = (input.taxTreatment ?? "").trim();
  if (!oneLine(taxTreatment, 3, 300))
    throw new ValoProblem(422, "Give the tax treatment on one line, in 3 to 300 characters.");
  const from = input.from ?? "now";
  if (
    from !== "now" &&
    !(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(from) &&
      Number.isFinite(Date.parse(from))
    )
  )
    throw new ValoProblem(
      422,
      "Give the start as now, or as a time with its offset, such as 2026-12-01T00:00:00+01:00.",
    );
  return {
    bundle,
    title,
    // One order, whatever order they were chosen in, so the same templates give the same checksum.
    items: items.sort(),
    amountKobo: nairaToKobo(input.amount ?? ""),
    licenceVersion,
    licenceText,
    taxTreatment,
    from,
  };
}

/** The checksum the owner confirms: of the exact terms, so a changed figure, word or template needs a new
 * confirmation. */
export function bundleTermsId(terms: BundleTerms) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "valo-bundle-v1",
        terms.bundle,
        terms.title,
        terms.items,
        terms.amountKobo,
        terms.licenceVersion,
        terms.licenceText,
        terms.taxTreatment,
        terms.from,
      ]),
    )
    .digest("hex");
}

/** A premium template a bundle may hold, and whether it is on sale now. */
export type BundleTemplate = { item: string; title: string; onSale: boolean };

/**
 * The staff library's premium templates that have been released, or those wanted, by title: each with the
 * title of its latest release and whether that release is on sale now, not held and not overdue for its
 * review (docs/architecture/guidance-currency.md). Read-only.
 */
export async function bundleTemplates(tx: Pick<Tx, "execute">, wanted?: readonly string[]) {
  if (wanted && !wanted.length) return [];
  const { rows } = await tx.execute<BundleTemplate>(sql`
    select latest.item, latest.title, coalesce(live.held = false, false) as "onSale"
      from (
        select distinct on (m.item_id) m.item_id as item, m.id, m.title
          from public.valo_manual_library m
         where m.kind = 'premium_template' and m.published_at is not null
           ${wanted ? sql`and m.item_id in ${[...wanted]}` : sql``}
         order by m.item_id, m.version desc
      ) latest
      left join (
        select v.edition, coalesce((to_jsonb(v) ->> 'held')::boolean, false) as held
          from public.valo_live_manual_premium_versions(null) v
      ) live on live.edition = latest.id
     order by latest.title, latest.item`);
  return rows;
}

export type BundleApproval = { approvedBy: string; reference: string; confirm: string };

/**
 * Records a bundle's version in the caller's transaction, and closes the bundle's open version when the new
 * one starts. Refused unless `confirm` is the checksum of exactly these terms, and unless each template is a
 * premium template of the staff library that has been released.
 */
export async function recordBundleIn(tx: Tx, terms: BundleTerms, approval: BundleApproval) {
  if (approval.confirm !== bundleTermsId(terms))
    throw new ValoProblem(
      409,
      "The confirmation is not the checksum of these terms. Preview them again and confirm that.",
    );
  const approvedBy = approval.approvedBy.trim(),
    reference = approval.reference.trim();
  if (!oneLine(approvedBy, 2, 120)) throw new ValoProblem(422, "Name who approved the bundle, on one line.");
  if (!oneLine(reference, 3, 160))
    throw new ValoProblem(422, "Say where the approval is written, on one line.");
  const { valoBundles: b } = await import("@workspace/db");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"bundle:" + terms.bundle}, 0))`);
  if ((await bundleTemplates(tx, terms.items)).length !== terms.items.length)
    throw new ValoProblem(409, NOT_BUNDLEABLE);
  const { rows } = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
  const now = new Date(rows[0]!.now);
  const from = terms.from === "now" ? now : new Date(terms.from);
  if (+from < +now)
    throw new ValoProblem(
      409,
      "This bundle would start in the past. Preview it again with now or a later start.",
    );
  // A version that starts now starts at the transaction's own time, as the database holds it: a copy read
  // back keeps only milliseconds, and closing a version a fraction before now() is refused.
  const start = terms.from === "now" ? sql`now()` : from;
  const open = await tx
    .select()
    .from(b)
    .where(and(eq(b.bundleKey, terms.bundle), or(isNull(b.effectiveTo), gt(b.effectiveTo, start))))
    .orderBy(asc(b.effectiveFrom), asc(b.id))
    .for("update");
  const scheduled = open.find((version) => +version.effectiveFrom >= +from);
  if (scheduled)
    throw new ValoProblem(
      409,
      `A version of this bundle already starts at ${scheduled.effectiveFrom.toISOString()}. Start the new one after it.`,
    );
  const ending = open.find((version) => version.effectiveTo !== null);
  if (ending)
    throw new ValoProblem(
      409,
      `This bundle's version already ends at ${ending.effectiveTo!.toISOString()}. Start the new one then or later.`,
    );
  for (const version of open) await tx.update(b).set({ effectiveTo: start }).where(eq(b.id, version.id));
  const [recorded] = await tx
    .insert(b)
    .values({
      bundleKey: terms.bundle,
      title: terms.title,
      items: terms.items,
      amountKobo: terms.amountKobo,
      currency: "NGN",
      licenceVersion: terms.licenceVersion,
      licenceText: terms.licenceText,
      taxTreatment: terms.taxTreatment,
      approvalReference: `${reference} (approved by ${approvedBy})`,
      effectiveFrom: start,
    })
    .returning({ id: b.id, effectiveFrom: b.effectiveFrom });
  return {
    bundleId: recorded!.id,
    bundle: terms.bundle,
    title: terms.title,
    amountKobo: terms.amountKobo,
    from: recorded!.effectiveFrom,
    closed: open.map((version) => ({ bundleId: version.id, amountKobo: version.amountKobo })),
  };
}

/** Each bundle's open version and any scheduled to start, and the premium templates a bundle may hold.
 * Read-only. */
export async function bundleStatus() {
  const { db: store, valoBundles: b } = await import("@workspace/db");
  const versions = await store
    .select({
      bundleId: b.id,
      bundle: b.bundleKey,
      title: b.title,
      items: b.items,
      amountKobo: b.amountKobo,
      licenceVersion: b.licenceVersion,
      taxTreatment: b.taxTreatment,
      effectiveFrom: b.effectiveFrom,
      effectiveTo: b.effectiveTo,
    })
    .from(b)
    .where(or(isNull(b.effectiveTo), gt(b.effectiveTo, sql`now()`)))
    .orderBy(asc(b.bundleKey), asc(b.effectiveFrom), asc(b.id));
  return { versions, templates: await bundleTemplates(store) };
}
