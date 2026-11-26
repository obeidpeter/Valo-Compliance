import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { publicationSchema } from "@workspace/valo-core";
import type { WorkspaceActor } from "../workspaces";
import { latestReleased, releasedStates } from "./replaced-versions";
import { documentInput } from "../../lib/valo-validation";

/** A reviewed version's title, as its page names it: the title of the document its bundle holds. */
function reviewedTitle(bundle: unknown, templateId: string) {
  try {
    return documentInput.parse(JSON.parse(publicationSchema.parse(bundle).candidate.body)).title;
  } catch {
    // A bundle that does not parse is named by its template's identifier, as nothing else names it.
    return templateId;
  }
}

/** The edition a document was made from, as it stands now. */
export type RecordedEdition = {
  version: number;
  withdrawn: boolean;
  withdrawnAt: Date | null;
  reason: string | null;
};
/** The latest edition of the same template that was ever released, if a later one. */
export type LatestEdition = {
  version: number;
  withdrawn: boolean;
  releasedAt: Date | null;
  withdrawnAt: Date | null;
  reason: string | null;
  href: string;
} | null;

/**
 * Where a document's template edition stands (docs/architecture/editions.md, slice 1): replaced when a
 * later edition is released now, withdrawn when the edition, or the later edition that replaced it,
 * was withdrawn and none is released since. Null while the edition is still the template's release. A
 * withdrawn edition with a later release counts as replaced.
 */
export function editionStanding(recorded: RecordedEdition, latest: LatestEdition) {
  if (latest && latest.version > recorded.version) {
    if (!latest.withdrawn)
      return {
        state: "replaced" as const,
        since: latest.releasedAt,
        reason: null,
        current: { version: latest.version, href: latest.href },
      };
    return { state: "withdrawn" as const, since: latest.withdrawnAt, reason: latest.reason, current: null };
  }
  if (recorded.withdrawn)
    return {
      state: "withdrawn" as const,
      since: recorded.withdrawnAt,
      reason: recorded.reason,
      current: null,
    };
  return null;
}

/**
 * The workspace's documents whose template edition was replaced or withdrawn, with where it stands, on
 * both routes. A document made from no template, or from the template's current edition, is not
 * listed. The document itself never changes (DOC-007).
 */
export async function listDocumentEditions(actor: WorkspaceActor) {
  const { db, valoContentVersions, valoDocuments } = await import("@workspace/db");
  const at = (value: Date | string | null) => (value === null ? null : new Date(value));
  // The staff library's editions, read through its owner's function: a customer request cannot read
  // the editorial table.
  const { rows: library } = await db.execute<{
    document: string;
    title: string;
    version: number;
    latest_version: number;
    latest_slug: string;
    latest_state: string;
    latest_published_at: Date | string | null;
    latest_closed_at: Date | string | null;
    // Absent until the edition notices migration is applied (docs/valo/migration-edition-notices.md).
    latest_reason?: string | null;
  }>(sql`select * from public.valo_workspace_document_editions()`);
  const items = library.flatMap((row) => {
    const latestIsRecorded = row.latest_version === row.version;
    const standing = editionStanding(
      {
        version: row.version,
        withdrawn: latestIsRecorded && row.latest_state === "withdrawn",
        withdrawnAt: latestIsRecorded ? at(row.latest_closed_at) : null,
        reason: latestIsRecorded ? (row.latest_reason ?? null) : null,
      },
      latestIsRecorded
        ? null
        : {
            version: row.latest_version,
            withdrawn: row.latest_state === "withdrawn",
            releasedAt: at(row.latest_published_at),
            withdrawnAt: at(row.latest_closed_at),
            reason: row.latest_reason ?? null,
            href: "/library/" + encodeURIComponent(row.latest_slug),
          },
    );
    return standing
      ? [{ documentId: row.document, title: row.title, version: row.version, ...standing }]
      : [];
  });
  // The reviewed route's versions, which the workspace's scope reads, against each template's latest
  // released version, withdrawn or not: a version replaced by one since withdrawn reads withdrawn
  // (docs/architecture/reviewed-route.md, part 1). A reviewed version records no date of withdrawal,
  // and its reason is written for staff, not customers, so neither is shown.
  const reviewed = await db
    .select({
      document: valoDocuments.id,
      templateId: valoContentVersions.templateId,
      version: valoContentVersions.version,
      status: valoContentVersions.status,
      bundle: valoContentVersions.bundle,
    })
    .from(valoDocuments)
    .innerJoin(valoContentVersions, eq(valoContentVersions.id, valoDocuments.templateVersionId))
    .where(and(eq(valoDocuments.workspaceId, actor.workspaceId), isNotNull(valoDocuments.templateVersionId)));
  if (reviewed.length) {
    const latest = latestReleased(
      await db
        .select({
          templateId: valoContentVersions.templateId,
          version: valoContentVersions.version,
          status: valoContentVersions.status,
          slug: valoContentVersions.slug,
          publishedAt: valoContentVersions.publishedAt,
        })
        .from(valoContentVersions)
        .where(
          and(
            inArray(valoContentVersions.templateId, [...new Set(reviewed.map((row) => row.templateId))]),
            inArray(valoContentVersions.status, [...releasedStates]),
          ),
        ),
    );
    for (const row of reviewed) {
      const now = latest.get(row.templateId);
      const standing = editionStanding(
        {
          version: row.version,
          withdrawn: row.status === "withdrawn",
          withdrawnAt: null,
          reason: null,
        },
        now
          ? {
              version: now.version,
              withdrawn: now.status === "withdrawn",
              releasedAt: now.publishedAt,
              withdrawnAt: null,
              reason: null,
              href: "/library/" + encodeURIComponent(now.slug),
            }
          : null,
      );
      if (standing)
        items.push({
          documentId: row.document,
          title: reviewedTitle(row.bundle, row.templateId),
          version: row.version,
          ...standing,
        });
    }
  }
  return {
    items: items.slice(0, 200).map((item) => ({ ...item, since: item.since?.toISOString() ?? null })),
  };
}
