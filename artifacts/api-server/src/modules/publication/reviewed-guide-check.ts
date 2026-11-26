import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

/**
 * What the admission of a guide's reviews and the publish command refuse with when the development owner
 * has not checked the guide's sources within the last day (docs/architecture/reviewed-route.md, part 2).
 */
export const OWNER_SOURCE_CHECK_REQUIRED = "OWNER_SOURCE_CHECK_REQUIRED";

/**
 * Whether the development owner checked this exact prepared guide's official sources, through the captures
 * its attestations bind, within the last day (decision 0018). The database function answers as its owner,
 * so the publisher's role reads no check and no staff record itself.
 */
export async function reviewedGuideChecked(
  reader: Pick<typeof db, "execute">,
  versionId: string,
  candidateHash: string,
  sourceSnapshots: Record<string, string> | undefined,
) {
  const { rows } = await reader.execute<{ checked: boolean }>(
    sql`select valo_reviewed_guide_checked(${versionId}::uuid, ${candidateHash}, ${JSON.stringify(sourceSnapshots ?? {})}::jsonb) as checked`,
  );
  return rows[0]?.checked === true;
}
