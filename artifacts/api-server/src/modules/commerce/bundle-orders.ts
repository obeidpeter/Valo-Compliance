import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db, valoBundles } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { isDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { premiumEditions, type PremiumEdition } from "./premium-editions";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Tx, "execute" | "select">;

/**
 * Buying a bundle (docs/architecture/commercial-settings.md, slice 4c; ADM-006). Checkout offers a bundle's
 * version in effect while each of its templates has a released edition that is neither held nor overdue for
 * its review. A bundle's order copies the bundle's terms and, for each template, the edition it grants.
 */

/** A bundle on sale now, with the edition each of its templates grants. */
export type BundleOffer = {
  id: string;
  bundle: string;
  title: string;
  amountKobo: number;
  currency: string;
  licenceVersion: string;
  licenceText: string;
  taxTreatment: string;
  /** Each template's released edition, by title. */
  templates: { edition: string; title: string }[];
};

/** Why a bundle cannot be ordered now. */
export const BUNDLE_UNAVAILABLE = "This bundle is not on sale now. No order was created.";
export const BUNDLE_TEMPLATE_UNAVAILABLE =
  "A template in this bundle is not available for purchase now. No order was created.";

/** Each of a bundle version's templates with its released edition, if any, and whether that is held. */
async function bundleEditions(tx: Pick<Tx, "execute">, bundleId: string) {
  const { rows } = await tx.execute<{
    item: string;
    edition: string | null;
    title: string | null;
    held: boolean | null;
  }>(sql`select item, edition, title, held from public.valo_bundle_editions(${bundleId}::uuid)`);
  return rows;
}

/** The templates of a bundle's version, each with its released edition, or none if one cannot be sold. */
async function saleableTemplates(tx: Pick<Tx, "execute">, bundleId: string) {
  const rows = await bundleEditions(tx, bundleId);
  if (!rows.length || rows.some((row) => !row.edition || row.held !== false)) return null;
  return rows
    .map((row) => ({ edition: row.edition!, title: row.title! }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.edition.localeCompare(b.edition));
}

/**
 * The bundles on sale now: each version in effect whose templates all have an edition on sale. The staff
 * library, whose premium templates bundles hold, runs only in development, and so do bundles.
 */
export async function bundleOffers(reader: Reader = db): Promise<BundleOffer[]> {
  if (!isDevelopmentRuntime()) return [];
  const b = valoBundles;
  const versions = await reader
    .select()
    .from(b)
    .where(and(lte(b.effectiveFrom, sql`now()`), or(isNull(b.effectiveTo), gt(b.effectiveTo, sql`now()`))))
    .orderBy(asc(b.title), asc(b.id));
  const offers: BundleOffer[] = [];
  for (const version of versions) {
    if (!version.approvalReference) continue;
    const templates = await saleableTemplates(reader, version.id);
    if (templates)
      offers.push({
        id: version.id,
        bundle: version.bundleKey,
        title: version.title,
        amountKobo: version.amountKobo,
        currency: version.currency,
        licenceVersion: version.licenceVersion,
        licenceText: version.licenceText,
        taxTreatment: version.taxTreatment,
        templates,
      });
  }
  return offers;
}

/**
 * The bundle's version a new order is for, read in the caller's transaction and held to its end, as a price
 * is, with each template's edition checked again under its own lock: it may have been withdrawn, fallen due
 * for its review or been held by staff since the offer was read. Refused unless the version is in effect
 * now, with the owner's approval, and every template can be sold.
 */
export async function bundleForOrder(tx: Tx, bundleId: string) {
  const [version] = await tx.select().from(valoBundles).where(eq(valoBundles.id, bundleId)).for("share");
  if (
    !version ||
    !version.approvalReference ||
    +version.effectiveFrom > Date.now() ||
    (version.effectiveTo && +version.effectiveTo <= Date.now()) ||
    !isDevelopmentRuntime()
  )
    throw new ValoProblem(409, BUNDLE_UNAVAILABLE);
  const templates = await saleableTemplates(tx, version.id);
  if (!templates) throw new ValoProblem(409, BUNDLE_TEMPLATE_UNAVAILABLE);
  for (const template of templates) {
    const { rows } = await tx.execute<PremiumEdition>(premiumEditions(template.edition));
    if (!rows[0] || rows[0].held) throw new ValoProblem(409, BUNDLE_TEMPLATE_UNAVAILABLE);
  }
  return { version, templates };
}
