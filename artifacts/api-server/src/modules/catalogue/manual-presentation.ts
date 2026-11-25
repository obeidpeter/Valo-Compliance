import { baselineTemplates, libraryTemplateStatement } from "@workspace/valo-core";
import { isManualTemplate, type releasedManualEntries } from "../manual-library";
import { templateCategory, type ReleasedLibraryItem } from "./valo-catalogue";
import { templatePreview } from "./template-preview";

type PublicRevision = Awaited<ReturnType<typeof releasedManualEntries>>[number];
/** What the library lists of an entry; a customer request reads only this of a template
 * (`liveLibraryTemplates`). */
export type CatalogueRow = Pick<
  PublicRevision,
  "id" | "slug" | "title" | "kind" | "industry" | "body" | "purpose" | "sourceCheckedAt" | "publishedAt"
>;
export const manualResourceKind = (row: Pick<PublicRevision, "kind">) =>
  row.kind === "regulatory_article"
    ? ("guidance" as const)
    : row.kind === "industry_introduction"
      ? ("industry_introduction" as const)
      : row.kind === "industry_pack"
        ? ("industry_pack" as const)
        : ("guide" as const);
const summary = (row: Pick<PublicRevision, "body">) => row.body.replace(/\s+/g, " ").slice(0, 260);
const disclosure = "Published by the Valo editorial team.";
/** The registered template an entry is filed as, by its title, as the staff library's access check
 * finds it. */
const registeredTemplate = (title: string) =>
  baselineTemplates.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
export function manualResource(row: PublicRevision) {
  const regulatory = row.kind === "regulatory_article";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: manualResourceKind(row),
    publicationMethod: "manual" as const,
    industrySlugs: row.industry ? [row.industry] : [],
    summary: summary(row),
    body: row.body,
    reviewedAt: (row.sourceCheckedAt ?? row.publishedAt)!.toISOString(),
    disclosure: regulatory
      ? "The Valo development owner checked this version against the official sources shown. This article received no independent professional review."
      : disclosure,
    scope: regulatory
      ? "Nigerian national rules on this subject."
      : row.industry
        ? row.industry.replaceAll("-", " ")
        : "General business",
    limitations: regulatory
      ? "General information. State and local requirements and individual facts may differ."
      : "Everyday business guidance.",
    sources: (row.regulatorySources ?? []).map(({ url, title, locator }) => ({ url, title, locator })),
  };
}
export function manualCatalogue(row: CatalogueRow): ReleasedLibraryItem {
  const template = isManualTemplate(row.kind);
  // A template filed as a registered one is listed by that template's number and category
  // (docs/architecture/results.md).
  const registered = template ? registeredTemplate(row.title) : undefined;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: template ? "template" : row.kind === "regulatory_article" ? "guidance" : "article",
    industry: row.industry ?? "All industries",
    // A template released with its entry details is listed by what it is for.
    summary: (template && row.purpose) || summary(row),
    ...(template ? { templateId: row.slug } : {}),
    ...(registered && { templateNumber: registered.id }),
    category: template
      ? registered
        ? templateCategory(registered.id)
        : "Business templates"
      : row.kind === "industry_introduction"
        ? "Industry introductions"
        : row.kind === "industry_pack"
          ? "Industry packs"
          : row.kind === "regulatory_article"
            ? "Regulatory guidance"
            : "Practical business guides",
    access: row.kind === "premium_template" ? "premium" : "free",
    ...(row.kind === "premium_template" && {
      premiumDownloadPath: "/api/workspace/manual-premium-templates/" + row.id + "/download",
    }),
    ...(row.kind === "template" && {
      freeDownloadPath: "/api/account/manual-templates/" + row.id + "/download",
    }),
    reviewedAt: (row.sourceCheckedAt ?? row.publishedAt)!.toISOString(),
    href: (template ? "/library/" : "/resources/") + row.slug,
  };
}
/**
 * A released staff-library template's page (docs/architecture/library-entries.md): its entry details
 * as released with its version, the statement of how it was written and checked that follows from
 * them, and its related guides that are released now, from `released`.
 */
export function manualTemplate(row: PublicRevision, released: readonly PublicRevision[] = []) {
  const related = (row.relatedItems ?? []).flatMap((itemId) => {
    const guide = released.find((entry) => entry.itemId === itemId && !isManualTemplate(entry.kind));
    return guide
      ? [{ title: guide.title, href: "/resources/" + guide.slug, kind: manualResourceKind(guide) }]
      : [];
  });
  return {
    id: row.id,
    templateId: row.slug,
    slug: row.slug,
    title: row.title,
    summary: row.purpose ?? summary(row),
    version: row.version,
    publicationMethod: "manual" as const,
    reviewedAt: row.publishedAt!.toISOString(),
    access: row.kind === "premium_template" ? ("premium" as const) : ("free" as const),
    reviewBy: null,
    disclosure: libraryTemplateStatement(row.aiDrafted),
    scope: "Business template",
    limitations: row.limits ?? "",
    preview: [templatePreview(row.body)],
    developmentOnly: true,
    commercialLicenceAccepted: false,
    formats: [row.fileFormat!],
    ...(row.purpose ? { purpose: row.purpose } : {}),
    ...(row.needs ? { needs: row.needs.split("\n") } : {}),
    ...(related.length ? { relatedGuides: related } : {}),
  };
}
