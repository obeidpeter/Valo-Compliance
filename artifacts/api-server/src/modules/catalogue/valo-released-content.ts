import { and, eq } from "drizzle-orm";
import type { db, valoContentVersions } from "@workspace/db";
import {
  baselineTemplates,
  evaluatePublication,
  publicationSchema,
  coveragePlan,
} from "@workspace/valo-core";
import {
  developmentPublicationOnly,
  operationalPolicy,
  practicalGuideReleasePolicy,
  getPublicationArtifact,
  type ArtifactRef,
  currentOperationalPermission,
  guidancePolicy,
  guidePageText,
  guideReferences,
} from "../publication";
import { createDocumentInTransaction, getDocument } from "../documents";
import { authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import { documentInput } from "../../lib/valo-validation";
import {
  paginateReleasedItems,
  templateCategory,
  templateSummary,
  type CatalogueQuery,
  type ReleasedLibraryItem,
} from "./valo-catalogue";
import { setting } from "../../platform/settings";
import { lockSourceState, sourceTargetAllowed } from "../sources";
import { isManualTemplate, releasedManualEntries } from "../manual-library";
import { manualCatalogue, manualResource, manualResourceKind, manualTemplate } from "./manual-presentation";
import {
  approvedPricesForEditions,
  isFreeBaselineTemplate,
  offerForReleasedEdition,
} from "./template-prices";
function parseVisibleBundle(
  row: typeof valoContentVersions.$inferSelect,
  policyHash: string,
  now = new Date(),
) {
  if (row.status !== "published" || +row.reviewBy <= +now) return null;
  const parsed = publicationSchema.safeParse(row.bundle);
  if (
    !parsed.success ||
    parsed.data.candidate.hash !== row.candidateHash ||
    parsed.data.policy.hash !== policyHash ||
    evaluatePublication(parsed.data, now).decision !== "eligible"
  )
    return null;
  return parsed.data;
}
export function releaseVisible(
  row: typeof valoContentVersions.$inferSelect,
  policyHash: string,
  now = new Date(),
) {
  return parseVisibleBundle(row, policyHash, now) !== null;
}
/**
 * Whether a published guide's policy still stands: the policy it was released under must be the
 * guidance policy as it is today, with the owner's approval of it. An edit to the policy file ends
 * that approval, and a suspension in the owner's restriction file changes the policy, so either
 * takes every guide off the site until it is released again under the policy then approved.
 */
export function guidePolicyStands(
  releasedUnderHash: string,
  current: { hash: string; ownerApproved: boolean },
) {
  return current.ownerApproved && releasedUnderHash === current.hash;
}
export async function liveReleasedVersions() {
  const { db, valoContentVersions, valoPublicationPolicies } = await import("@workspace/db");
  if (setting("NODE_ENV") !== "development" || setting("REPLIT_DEPLOYMENT")) return [];
  const [currentPolicy, rows] = await Promise.all([
    operationalPolicy(),
    db
      .select({ content: valoContentVersions, policy: valoPublicationPolicies })
      .from(valoContentVersions)
      .innerJoin(valoPublicationPolicies, eq(valoContentVersions.policyId, valoPublicationPolicies.id))
      .where(eq(valoContentVersions.status, "published")),
  ]);
  const visible = rows.flatMap((r) => {
    const bundle = parseVisibleBundle(r.content, r.policy.hash);
    return bundle ? [{ row: r, bundle }] : [];
  });
  const needsGuidancePolicy = visible.some(
    ({ bundle }) => bundle.candidate.contentClass === "sourced_guidance",
  );
  const currentGuidance = needsGuidancePolicy ? (await guidancePolicy()).policy : undefined;
  const checked = await Promise.all(
    visible.map(async ({ row: r, bundle }) => {
      if (!(await sourceTargetAllowed(db, "content", r.content.id, r.content.bundle))) return null;
      const candidate = bundle.candidate;
      if (candidate.evidenceMode === "original_operational") {
        const policy =
          candidate.contentClass === "practical_guide"
            ? (await practicalGuideReleasePolicy(candidate))?.policy
            : currentPolicy.policy;
        if (
          !policy?.ownerApproved ||
          r.policy.hash !== policy.hash ||
          !(await currentOperationalPermission(r.content))
        )
          return null;
      }
      // A guide answers to the guidance policy, as a template answers to the templates' one, and its
      // wording rests on the same kind of provider permission, which must still be current.
      if (candidate.contentClass === "sourced_guidance") {
        if (
          !currentGuidance ||
          !guidePolicyStands(r.policy.hash, currentGuidance) ||
          !(await currentOperationalPermission(r.content))
        )
          return null;
      }
      return r.content;
    }),
  );
  const allowed = checked.filter((item): item is typeof valoContentVersions.$inferSelect => item !== null);
  return allowed
    .sort((a, b) => b.version - a.version)
    .filter((r, i, all) => all.findIndex((v) => v.templateId === r.templateId) === i);
}
export async function liveOperationalVersions() {
  return (await liveReleasedVersions()).filter(
    (r) => publicationSchema.parse(r.bundle).candidate.contentClass === "general_template",
  );
}
export function projectReleasedResource(row: typeof valoContentVersions.$inferSelect) {
  const b = publicationSchema.parse(row.bundle),
    c = b.candidate;
  if (c.contentClass === "general_template") throw new Error("Not a released resource class");
  // A guide prepared through the publisher carries its document; the page shows the guide's own
  // words out of it. Any other body is shown as the text it is.
  const guide = guidePageText(c.body);
  const first = c.body
    .split("\n")
    .find((l) => l.trim())
    ?.replace(/^#{1,6}\s+/, "")
    .trim();
  const title = guide?.title ?? (first && first.length <= 140 ? first : row.slug.replace(/-/g, " "));
  const body = guide?.body ?? c.body;
  const kind = c.coverage?.kind ?? "guidance";
  if (kind === "template") throw new Error("Resource classification mismatch");
  return {
    id: row.id,
    slug: row.slug,
    title,
    kind,
    industrySlugs: c.coverage?.industrySlugs ?? [],
    summary: body.replace(/\s+/g, " ").slice(0, 260),
    body,
    reviewedAt: c.sourceCheckDate,
    disclosure: c.disclosure,
    scope: c.scope,
    limitations: c.limitations,
    sources: guideReferences(b),
  };
}
export async function releasedResources() {
  const [existing, manual] = await Promise.all([liveReleasedVersions(), releasedManualEntries()]);
  return [
    ...existing
      .filter((r) => publicationSchema.parse(r.bundle).candidate.contentClass !== "general_template")
      .map(projectReleasedResource),
    ...manual.filter((row) => !isManualTemplate(row.kind)).map(manualResource),
  ];
}
export async function releasedResource(slug: string) {
  if (slug.startsWith("manual-")) {
    const [row] = await releasedManualEntries(slug);
    return row && !isManualTemplate(row.kind) ? manualResource(row) : null;
  }
  const row = (await liveReleasedVersions()).find(
    (r) => r.slug === slug && publicationSchema.parse(r.bundle).candidate.contentClass !== "general_template",
  );
  return row ? projectReleasedResource(row) : null;
}
export async function publishedTemplateCount() {
  const [existing, manual] = await Promise.all([
    liveOperationalVersions(),
    releasedManualEntries({ summaryOnly: true }),
  ]);
  return existing.length + manual.filter((row) => isManualTemplate(row.kind)).length;
}
export function operationalPresentation(templateId: string) {
  if (templateId === "TPL-07")
    return {
      summary: templateSummary(templateId),
      preview: [
        "SAMPLE FIELD: Business name [your information]",
        "SAMPLE FIELDS: Item, unit and location [your information]",
        "SAMPLE SECTIONS: Receipts, issues, adjustments and physical counts [your records]",
      ],
    };
  if (templateId === "TPL-06")
    return {
      summary: templateSummary(templateId),
      preview: [
        "SAMPLE FIELD: Claimant [your information]",
        "SAMPLE FIELDS: Expense date, description, amount and currency [your records]",
        "SAMPLE FIELD: Internal review notes [your process]",
      ],
    };
  return {
    summary: templateSummary(templateId),
    preview: [
      "SAMPLE FIELD: Business name [your information]",
      "SAMPLE FIELD: Document details [your information]",
    ],
  };
}
export async function liveCoverage() {
  const [existing, manual] = await Promise.all([
    liveReleasedVersions(),
    releasedManualEntries({ summaryOnly: true }),
  ]);
  return coveragePlan([
    ...existing.map((row) => {
      const c = publicationSchema.parse(row.bundle).candidate;
      return {
        id: row.templateId,
        kind: c.contentClass === "general_template" ? "template" : (c.coverage?.kind ?? "guidance"),
        industrySlugs: c.coverage?.industrySlugs ?? [],
        locationIds: c.coverage?.locationIds ?? [],
        sourceCheckedAt: c.sourceCheckDate,
      };
    }),
    ...manual.map((row) => ({
      id: row.slug,
      kind: isManualTemplate(row.kind) ? ("template" as const) : manualResourceKind(row),
      industrySlugs: row.industry ? [row.industry] : [],
      locationIds: [],
      sourceCheckedAt: row.sourceCheckedAt?.toISOString() ?? null,
    })),
  ]);
}
export function projectReleasedCatalogue(
  rows: (typeof valoContentVersions.$inferSelect)[],
): ReleasedLibraryItem[] {
  return rows.map((r) => {
    const c = publicationSchema.parse(r.bundle).candidate;
    if (c.contentClass !== "general_template") {
      const resource = projectReleasedResource(r);
      return {
        id: r.id,
        slug: r.slug,
        title: resource.title,
        type: resource.kind === "guide" ? "article" : "guidance",
        industry: resource.industrySlugs.join(",") || "All industries",
        summary: resource.summary,
        category:
          resource.kind === "industry_pack"
            ? "Industry guidance"
            : resource.kind === "location_pack"
              ? "Location guidance"
              : c.contentClass === "practical_guide"
                ? "Practical business guides"
                : "Business guidance",
        access: "free" as const,
        reviewedAt: resource.reviewedAt,
        href: "/resources/" + encodeURIComponent(r.slug),
      };
    }
    const document = documentInput.parse(JSON.parse(publicationSchema.parse(r.bundle).candidate.body));
    const free = isFreeBaselineTemplate(r.templateId);
    const file = "/api/workspace/templates/" + r.id + "/files/docx";
    return {
      id: r.id,
      slug: r.slug,
      title: document.title,
      type: "template",
      industry: c.coverage?.industrySlugs.join(",") || "All industries",
      templateId: r.templateId,
      category: templateCategory(r.templateId),
      access: free ? ("free" as const) : ("premium" as const),
      ...(free ? { freeDownloadPath: file } : { premiumDownloadPath: file }),
      reviewedAt: c.sourceCheckDate,
      href: "/library/" + encodeURIComponent(r.slug),
      summary: operationalPresentation(r.templateId).summary,
    };
  });
}
/** These are existing public enquiry/directory pages, not publications, providers
 * or regulatory evidence. They contain no source documents or private records. */
export function directorySearchItems(): ReleasedLibraryItem[] {
  const services: [slug: string, title: string][] = [
    ["registration", "Business registration"],
    ["tax", "Tax"],
    ["accounting", "Accounting and bookkeeping"],
    ["employment", "Employment and staff"],
    ["legal", "Legal documents"],
    ["privacy", "Data protection and privacy"],
    ["sector_approval", "Sector approvals and permits"],
  ];
  return [
    ...services.map(([slug, title]) => ({
      id: "service:" + slug,
      slug,
      title,
      type: "service",
      industry: "All industries",
      category: "Service enquiries",
      summary:
        "Enquiry category only. No professional provider is listed and no appointment or referral is confirmed.",
      href: "/services?category=" + slug,
    })),
    ...coveragePlan().industries.map((i) => ({
      id: "industry:" + i.slug,
      slug: i.slug,
      title: i.title,
      type: "industry",
      industry: i.slug,
      category: "Industry directory",
      summary:
        "Browse this industry’s coverage page. Only currently released guidance is shown; coverage gaps are not exemptions.",
      href: "/industries/" + encodeURIComponent(i.slug),
    })),
  ];
}
export async function releasedCatalogue(query: CatalogueQuery = {}) {
  const [all, manual] = await Promise.all([
    liveReleasedVersions(),
    releasedManualEntries({ summaryOnly: true }),
  ]);
  const items = [...projectReleasedCatalogue(all), ...manual.map(manualCatalogue)];
  const reviewedIds = new Set(all.map((row) => row.templateId));
  const manualTitles = new Set(
    manual.filter((row) => isManualTemplate(row.kind)).map((row) => row.title.toLowerCase()),
  );
  const page = paginateReleasedItems([...items, ...directorySearchItems()], query);
  const prices = await approvedPricesForEditions(
    page.items.filter((item) => item.type === "template" && item.access === "premium").map((item) => item.id),
  );
  return {
    ...page,
    items: page.items.map((item) => {
      const price = prices.get(item.id);
      return price ? { ...item, ...price } : item;
    }),
    heldTemplates: baselineTemplates.filter(
      (entry) => !reviewedIds.has(entry.id) && !manualTitles.has(entry.title.toLowerCase()),
    ).length,
  };
}
export async function releasedTemplate(slug: string) {
  if (slug.startsWith("manual-")) {
    const [row] = await releasedManualEntries(slug);
    if (!row || !isManualTemplate(row.kind)) throw new ValoProblem(404, "This template is unavailable.");
    const offer = row.kind === "premium_template" ? await offerForReleasedEdition(row.id) : undefined;
    return { ...manualTemplate(row), offer };
  }
  const row = (await liveOperationalVersions()).find((r) => r.slug === slug);
  if (!row)
    throw new ValoProblem(
      404,
      "This template is not available. It may have been withdrawn, or it may not be published yet.",
    );
  const bundle = publicationSchema.parse(row.bundle),
    document = documentInput.parse(JSON.parse(bundle.candidate.body));
  const free = isFreeBaselineTemplate(row.templateId);
  const offer = free ? undefined : await offerForReleasedEdition(row.id);
  return {
    id: row.id,
    templateId: row.templateId,
    slug: row.slug,
    title: document.title,
    summary: operationalPresentation(row.templateId).summary,
    version: row.version,
    reviewedAt: bundle.candidate.sourceCheckDate,
    reviewBy: row.reviewBy.toISOString(),
    disclosure: bundle.candidate.disclosure,
    scope: bundle.candidate.scope,
    limitations: bundle.candidate.limitations,
    preview: operationalPresentation(row.templateId).preview,
    developmentOnly: true,
    commercialLicenceAccepted: false,
    ...(free && { access: "free" as const }),
    ...(offer && { access: "premium" as const, offer }),
    formats: ["docx", "pdf"] as const,
  };
}
declare const releaseChecked: unique symbol;
/** Proof that a version's evidence was checked outside any transaction. Only
 * `checkReleaseEvidence` creates one, and `lockedLiveVersion` requires it. */
export type CheckedRelease = {
  readonly id: string;
  /** True only when the version was visible and its operational evidence passed. */
  readonly operationalEvidence: boolean;
  readonly [releaseChecked]: true;
};
const evidenceUnresolved = () =>
  new ValoProblem(404, "This template is not available while Valo confirms that it may be offered.");
/**
 * Checks the rights and policy evidence an original operational version needs. That
 * evidence lives in the policy files and publication storage, so this runs before the
 * caller's transaction: no source-state lock or pooled connection is held while storage
 * answers. A version's bundle and attestations never change (a database trigger allows
 * only its status to change), so evidence read here still applies under the lock.
 */
export async function checkReleaseEvidence(id: string): Promise<CheckedRelease> {
  const { db, valoContentVersions, valoPublicationPolicies } = await import("@workspace/db");
  let operationalEvidence = false;
  const [row] = await db.select().from(valoContentVersions).where(eq(valoContentVersions.id, id));
  if (row) {
    const [policy] = await db
      .select({ hash: valoPublicationPolicies.hash })
      .from(valoPublicationPolicies)
      .where(eq(valoPublicationPolicies.id, row.policyId));
    // A version that is not visible now is refused under the lock; skip its storage reads.
    if (
      policy &&
      releaseVisible(row, policy.hash) &&
      publicationSchema.parse(row.bundle).candidate.evidenceMode === "original_operational"
    ) {
      const current = await operationalPolicy();
      if (policy.hash !== current.policy.hash || !(await currentOperationalPermission(row)))
        throw evidenceUnresolved();
      operationalEvidence = true;
    }
  }
  return { id, operationalEvidence } as CheckedRelease;
}
/** The database checks for a released version, under the shared source-state lock so a
 * hold or withdrawal committed first wins. Storage evidence comes from `release`. */
export async function lockedLiveVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  release: CheckedRelease,
) {
  const { valoContentVersions, valoPublicationPolicies } = await import("@workspace/db");
  await lockSourceState(tx);
  const [row] = await tx
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.id, release.id))
    .for("share");
  if (!row) throw new ValoProblem(404, "This template is not available.");
  const [policy] = await tx
    .select()
    .from(valoPublicationPolicies)
    .where(eq(valoPublicationPolicies.id, row.policyId));
  if (
    !policy ||
    !releaseVisible(row, policy.hash) ||
    !(await sourceTargetAllowed(tx, "content", row.id, row.bundle))
  )
    throw new ValoProblem(404, "This template has been withdrawn or has expired, or it is not available.");
  // If the version was published after its evidence check, the evidence was never read:
  // refuse instead of reading storage under the lock. The next request checks it.
  if (
    publicationSchema.parse(row.bundle).candidate.evidenceMode === "original_operational" &&
    !release.operationalEvidence
  )
    throw evidenceUnresolved();
  return row;
}
/** Exported for the entitlement isolation test. */
export async function requirePurchaseForPricedMaster(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: WorkspaceActor,
  row: typeof valoContentVersions.$inferSelect,
) {
  const { valoEntitlements, valoPrices } = await import("@workspace/db");
  // Baseline TPL-01..12 are always free; a price record cannot silently change that contract.
  if (isFreeBaselineTemplate(row.templateId)) return;
  const [price] = await tx
    .select({ id: valoPrices.id })
    .from(valoPrices)
    .where(eq(valoPrices.contentVersionId, row.id))
    .limit(1);
  if (!price)
    throw new ValoProblem(
      403,
      "An approved licence and server-verified purchase are required for this premium document.",
    );
  const [grant] = await tx
    .select()
    .from(valoEntitlements)
    .where(
      and(
        eq(valoEntitlements.workspaceId, actor.workspaceId),
        eq(valoEntitlements.contentVersionId, row.id),
        eq(valoEntitlements.status, "active"),
      ),
    )
    .for("share");
  if (!grant)
    throw new ValoProblem(403, "This workspace does not have an active purchase for this template version.");
}
export async function createReleasedTemplateDraft(actor: WorkspaceActor, id: string) {
  const { db, valoDocuments } = await import("@workspace/db");
  developmentPublicationOnly();
  const release = await checkReleaseEvidence(id);
  const documentId = await db.transaction(async (tx) => {
    const row = await lockedLiveVersion(tx, release);
    await authorizeWorkspaceWrite(tx, actor);
    await requirePurchaseForPricedMaster(tx, actor, row);
    const document = documentInput.parse(JSON.parse(publicationSchema.parse(row.bundle).candidate.body));
    const documentId = await createDocumentInTransaction(tx, actor, document);
    await tx
      .update(valoDocuments)
      .set({ templateVersionId: id })
      .where(and(eq(valoDocuments.id, documentId), eq(valoDocuments.workspaceId, actor.workspaceId)));
    return documentId;
  });
  return getDocument(actor, documentId);
}
export async function readReleasedMaster(id: string, format: "docx" | "pdf", actor?: WorkspaceActor) {
  const { db } = await import("@workspace/db");
  developmentPublicationOnly();
  const release = await checkReleaseEvidence(id);
  const row = await db.transaction(async (tx) => {
    const row = await lockedLiveVersion(tx, release);
    if (!actor) throw new ValoProblem(403, "Sign in to your workspace to get this template's file.");
    await authorizeWorkspaceWrite(tx, actor);
    await requirePurchaseForPricedMaster(tx, actor, row);
    return row;
  });
  // The download was admitted under the lock; a hold committed later cannot recall it.
  // The bytes are read after the transaction, so no lock or connection is held while
  // storage answers. Their reference and hash come from the immutable version row.
  const a = row.attestations as { exports: Record<"docx" | "pdf", ArtifactRef> };
  return {
    bytes: await getPublicationArtifact(a.exports[format]),
    templateId: row.templateId,
    version: row.version,
  };
}
