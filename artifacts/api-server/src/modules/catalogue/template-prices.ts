import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
export const isFreeBaselineTemplate = (templateId: string) => /^TPL-(0[1-9]|1[0-2])$/.test(templateId);

function currentPriceTerms(p: typeof import("@workspace/db").valoPrices) {
  return {
    effective: and(
      ne(p.approvalReference, ""),
      lte(p.effectiveFrom, sql`now()`),
      or(isNull(p.effectiveTo), gt(p.effectiveTo, sql`now()`)),
    ),
    newestFirst: [desc(p.effectiveFrom), asc(p.id)],
  };
}

/** Commercial terms shared by the public edition and workspace checkout. Each caller also checks release visibility. */
export async function activeTemplatePrices(edition?: string) {
  const { db, valoPrices: p } = await import("@workspace/db");
  const { effective, newestFirst } = currentPriceTerms(p);
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
    .where(and(edition === undefined ? undefined : eq(p.contentVersionId, edition), effective))
    .orderBy(...newestFirst);
  return edition === undefined ? query : query.limit(1);
}

export async function approvedPricesForEditions(editions: string[]) {
  if (!editions.length) return new Map<string, { priceId: string; amountKobo: number }>();
  const { db, valoPrices: p } = await import("@workspace/db");
  const { effective, newestFirst } = currentPriceTerms(p);
  const rows = await db
    .selectDistinctOn([p.contentVersionId], {
      edition: p.contentVersionId,
      priceId: p.id,
      amountKobo: p.amountKobo,
    })
    .from(p)
    .where(and(inArray(p.contentVersionId, editions), effective))
    .orderBy(p.contentVersionId, ...newestFirst);
  return new Map(rows.map(({ edition, priceId, amountKobo }) => [edition, { priceId, amountKobo }]));
}

export async function offerForReleasedEdition(edition: string) {
  const [price] = await activeTemplatePrices(edition);
  return price?.product;
}
