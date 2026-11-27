import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whether the privacy holds migration has reached this database (PRV-003;
 * docs/architecture/privacy-requests.md, slice 4). Until it has, no hold can have been placed, so
 * nothing is held, and placing one is refused.
 */
export async function privacyHoldsReady(tx: Pick<Tx, "execute">) {
  const [found] = (
    await tx.execute<{ present: boolean }>(
      sql`select to_regprocedure('public.valo_workspace_under_hold(uuid)') is not null as present`,
    )
  ).rows;
  return found?.present === true;
}

/**
 * Whether a hold of its own stands on a workspace. It reads the reviewed database function, which a
 * customer request may call for its own workspace only, and which answers yes or no without the hold's
 * reason.
 */
export async function workspaceUnderHold(tx: Pick<Tx, "execute">, workspaceId: string) {
  if (!(await privacyHoldsReady(tx))) return false;
  const [row] = (
    await tx.execute<{ held: boolean }>(
      sql`select public.valo_workspace_under_hold(${workspaceId}::uuid) as held`,
    )
  ).rows;
  return row?.held === true;
}

/**
 * Stops Valo's own deletion of a held workspace's data. The erasure calls it before it starts, before
 * each file it deletes and before each batch of rows, so a hold placed while an erasure runs stops it at
 * its next check.
 */
export async function assertWorkspaceNotHeld(tx: Pick<Tx, "execute">, workspaceId: string) {
  if (await workspaceUnderHold(tx, workspaceId))
    throw new ValoProblem(
      409,
      "This workspace is held, so Valo's own deletion of its data has stopped. It goes on once privacy staff release the hold.",
    );
}
