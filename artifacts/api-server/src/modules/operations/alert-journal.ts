import { desc } from "drizzle-orm";
import { db, valoOperationalAlerts, type ValoOperationalAlert } from "@workspace/db";
import { systemAuthority, type StaffActor } from "../staff";
import { ValoProblem } from "../../platform/valo-problem";
import { alertTitle, type AlertChange } from "./valo-operations";

/** How many of the latest changes, raised and cleared, the staff list shows. */
export const ALERT_CHANGES_SHOWN = 50;

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): copies the worker's alert changes into the
 * database's journal, which staff read. A change the journal already holds, by its own id, is left as it
 * is, so copying it again does no harm. The journal's trigger refuses any change to a row it holds.
 */
export async function publishAlertChanges(
  changes: readonly AlertChange[],
  database: Pick<typeof db, "insert"> = db,
) {
  if (changes.length === 0) return;
  await database
    .insert(valoOperationalAlerts)
    .values(
      changes.map((change) => ({
        id: change.id,
        code: change.code,
        state: change.state,
        raisedAt: new Date(change.at),
        reading: change.reading ?? null,
        threshold: change.threshold ?? null,
        runbook: change.runbook ?? null,
        accountable: change.accountable ?? null,
      })),
    )
    .onConflictDoNothing({ target: valoOperationalAlerts.id });
}

function shown(row: ValoOperationalAlert) {
  return {
    id: row.id,
    code: row.code,
    title: alertTitle(row.code) ?? row.code,
    state: row.state as "active" | "resolved",
    at: row.raisedAt.toISOString(),
    reading: row.reading,
    threshold: row.threshold,
    runbook: row.runbook,
    accountable: row.accountable,
  };
}

/** A PostgreSQL error's code, through the driver's wrapper. */
function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}

/**
 * The alerts active now and the latest changes to them, for a system operator. Emergency system access
 * reads them too: an incident is when they are needed. Neither holds any customer's data.
 */
export async function operationalAlerts(actor: StaffActor, database: Pick<typeof db, "transaction"> = db) {
  try {
    return await readAlerts(actor, database);
  } catch (error) {
    // A database the journal's migrations have not reached has no journal yet; the worker keeps the
    // alerts in its file meanwhile, and copies them once the journal is there.
    if (pgCode(error) === "42P01")
      throw new ValoProblem(
        503,
        "Alerts cannot be shown yet: a database update is waiting to be applied. Until it is, the worker keeps them in its own file.",
      );
    throw error;
  }
}

function readAlerts(actor: StaffActor, database: Pick<typeof db, "transaction">) {
  return database.transaction(async (tx) => {
    await systemAuthority(tx, actor, "A current system assignment is required to read the alerts.", {
      emergency: true,
    });
    // Each alert's latest change: those whose latest change raised it are active.
    const latest = await tx
      .selectDistinctOn([valoOperationalAlerts.code])
      .from(valoOperationalAlerts)
      .orderBy(
        valoOperationalAlerts.code,
        desc(valoOperationalAlerts.raisedAt),
        desc(valoOperationalAlerts.recordedAt),
      );
    const changes = await tx
      .select()
      .from(valoOperationalAlerts)
      .orderBy(desc(valoOperationalAlerts.raisedAt), desc(valoOperationalAlerts.recordedAt))
      .limit(ALERT_CHANGES_SHOWN);
    return {
      active: latest
        .filter((row) => row.state === "active")
        .sort((a, b) => b.raisedAt.getTime() - a.raisedAt.getTime())
        .map(shown),
      changes: changes.map(shown),
    };
  });
}
