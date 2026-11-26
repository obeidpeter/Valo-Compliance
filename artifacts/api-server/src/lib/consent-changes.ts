import type { db } from "@workspace/db";
import { privacyNotice } from "@workspace/valo-core/privacy-notice";
import { ValoProblem } from "../platform/valo-problem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A PostgreSQL error's code, through the driver's wrapper. */
function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}

/**
 * Records a change to one of a workspace's optional choices: marketing messages or task reminders
 * (PRO-002; docs/architecture/processing-inventory.md, slice 4). The caller compares the new choice with
 * the one saved before it and calls this only when they differ. The row keeps who made the change,
 * what was chosen and the version of the privacy notice in force; the database adds when. Until the
 * consent changes migration is applied, the change is refused rather than saved without its record.
 */
export async function recordConsentChange(
  tx: Pick<Tx, "insert">,
  change: { workspaceId: string; actorId: string; consent: "marketing" | "reminders"; choice: boolean },
) {
  const { valoConsentChanges } = await import("@workspace/db");
  try {
    await tx.insert(valoConsentChanges).values({ ...change, noticeVersion: privacyNotice().version });
  } catch (error) {
    if (pgCode(error) === "42P01")
      throw new ValoProblem(
        503,
        "This choice cannot be saved yet: a database update is waiting to be applied. Nothing was changed.",
      );
    throw error;
  }
}
