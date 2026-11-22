import type { releasedManualEntries } from "../manual-library";
import type { ReleasedLibraryItem } from "./valo-catalogue";

type PublicRevision = Awaited<ReturnType<typeof releasedManualEntries>>[number];
export const manualResourceKind = (row: PublicRevision) =>
  row.kind === "industry_introduction" ? ("industry_introduction" as const) : ("guide" as const);
const summary = (row: PublicRevision) => row.body.replace(/\s+/g, " ").slice(0, 260);
const disclosure = "Published by the Valo editorial team.";
export function manualResource(row: PublicRevision) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: manualResourceKind(row),
    publicationMethod: "manual" as const,
    industrySlugs: row.industry ? [row.industry] : [],
    summary: summary(row),
    body: row.body,
    reviewedAt: row.publishedAt!.toISOString(),
    disclosure,
    scope: row.industry ? row.industry.replaceAll("-", " ") : "General business",
    limitations: "Everyday business guidance.",
    sources: [],
  };
}
export function manualCatalogue(row: PublicRevision): ReleasedLibraryItem {
  const template = row.kind === "template";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: template ? "template" : "article",
    industry: row.industry ?? "All industries",
    summary: summary(row),
    ...(template ? { templateId: row.slug } : {}),
    category: template
      ? "Business templates"
      : row.kind === "industry_introduction"
        ? "Industry introductions"
        : "Practical business guides",
    access: "free",
    reviewedAt: row.publishedAt!.toISOString(),
    href: (template ? "/library/" : "/resources/") + row.slug,
  };
}
export function manualTemplate(row: PublicRevision) {
  return {
    id: row.id,
    templateId: row.slug,
    slug: row.slug,
    title: row.title,
    summary: summary(row),
    version: row.version,
    publicationMethod: "manual" as const,
    reviewedAt: row.publishedAt!.toISOString(),
    reviewBy: null,
    disclosure,
    scope: "Business template",
    limitations: "Everyday business use.",
    preview: [row.body],
    developmentOnly: true,
    commercialLicenceAccepted: false,
    formats: [row.fileFormat!],
  };
}
