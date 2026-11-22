import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
export const isFreeBaselineTemplate = (templateId: string) => /^TPL-(0[1-9]|1[0-2])$/.test(templateId);

/** Commercial terms shared by the public edition and workspace checkout. Each caller also checks release visibility. */
export async function activeTemplatePrices(edition?: string) {
  const { db, valoPrices: p } = await import("@workspace/db");
  const query = db
    .select({
      edition: p.contentVersionId,
      product: {
        id: p.id,
        title: p.title,
        amountKobo: p.amountKobo,
        currency: p.currency,
        licenceVersion: p.licenceVersion,
        licenceText: p.licenceText,
        taxTreatment: p.taxTreatment,
      },
    })
    .from(p)
    .where(
      and(
        edition === undefined ? undefined : eq(p.contentVersionId, edition),
        ne(p.approvalReference, ""),
        lte(p.effectiveFrom, sql`now()`),
        or(isNull(p.effectiveTo), gt(p.effectiveTo, sql`now()`)),
      ),
    )
    .orderBy(desc(p.effectiveFrom), asc(p.id));
  return edition === undefined ? query : query.limit(1);
}

export async function offerForReleasedEdition(edition: string) {
  const [price] = await activeTemplatePrices(edition);
  return price?.product;
}
