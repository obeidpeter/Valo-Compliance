import { createHmac, randomUUID } from "node:crypto";
import { lte, sql } from "drizzle-orm";
import { db, valoEmailSuppressions } from "@workspace/db";
import { privacyKeys, privacySigner } from "../../lib/valo-privacy-keys";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How long an address stays suppressed after the last report about it (docs/architecture/messages.md,
 * part 3). After it the address is tried again, and suppressed again if its email service says the same.
 * A proposal, for the owner to decide.
 */
export const SUPPRESSION_LASTS_MS = 180 * 24 * 60 * 60_000;

/**
 * Whether a report suppresses its address, and as what: its email service sent a message back for good,
 * or reported it as spam. A bounce the provider does not call permanent, a delay and a failure of the
 * provider's own do not: the address may be good.
 */
export function suppresses(report: { delivery: string; detail: string | null }) {
  if (report.delivery === "complained") return "complained" as const;
  return report.delivery === "bounced" && report.detail === "PERMANENT" ? ("bounced" as const) : null;
}

/** An address as its checksum is made from it: letters in one case, no space around it. */
const checksum = (key: string, address: string) =>
  createHmac("sha256", key).update(`valo:email-suppression:v1:${address.trim().toLowerCase()}`).digest("hex");

/**
 * What a report keeps in place of the address it was about: the address's checksum under the privacy
 * keyring's current key, and that key's version. The address itself is kept nowhere.
 */
export async function addressChecksum(
  tx: Pick<Tx, "execute" | "select" | "selectDistinct">,
  address: string,
) {
  const signer = await privacySigner(tx);
  return { addressHash: checksum(signer.key, address), addressKeyVersion: signer.version };
}

/**
 * Stops optional messages to an address, from a report that suppresses it. A later report about the same
 * address keeps the suppression going, and never shortens it.
 */
export async function suppressAddress(
  executor: Pick<Tx, "insert">,
  about: { addressHash: string; addressKeyVersion: string },
  reason: "bounced" | "complained",
  reportedAt: Date,
) {
  const expiresAt = new Date(+reportedAt + SUPPRESSION_LASTS_MS);
  await executor
    .insert(valoEmailSuppressions)
    .values({
      id: randomUUID(),
      keyVersion: about.addressKeyVersion,
      addressHash: about.addressHash,
      reason,
      firstReportedAt: reportedAt,
      lastReportedAt: reportedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [valoEmailSuppressions.keyVersion, valoEmailSuppressions.addressHash],
      set: {
        reason: sql`CASE WHEN excluded.last_reported_at >= ${valoEmailSuppressions.lastReportedAt}
          THEN excluded.reason ELSE ${valoEmailSuppressions.reason} END`,
        firstReportedAt: sql`least(${valoEmailSuppressions.firstReportedAt}, excluded.first_reported_at)`,
        lastReportedAt: sql`greatest(${valoEmailSuppressions.lastReportedAt}, excluded.last_reported_at)`,
        expiresAt: sql`greatest(${valoEmailSuppressions.expiresAt}, excluded.expires_at)`,
      },
    });
}

/** Removes the suppressions whose time has passed. Returns how many. */
export async function removeExpiredSuppressions(executor: Pick<Tx, "delete">, now: Date) {
  return (
    await executor
      .delete(valoEmailSuppressions)
      .where(lte(valoEmailSuppressions.expiresAt, now))
      .returning({ id: valoEmailSuppressions.id })
  ).length;
}

/**
 * Whether Valo has stopped sending optional messages to an address. The address's checksum is made under
 * every key the privacy keyring holds, so a suppression recorded under an earlier key still counts.
 *
 * The database answers through `valo_email_address_suppressed`, which says only yes or no. A sender asks
 * from inside a workspace's scope, where the suppressions themselves cannot be read. If the question
 * cannot be asked, this throws, and the caller sends nothing.
 *
 * A database the suppression migration has not reached has no suppression, and takes no report that
 * could make one (`reportsCanBeTaken`). No address is suppressed there, and sending goes on as before.
 */
export async function addressSuppressed(address: string, executor: Pick<Tx, "execute"> = db) {
  const [table] = (
    await executor.execute<{ present: boolean }>(
      sql`select to_regclass('valo_email_suppressions') is not null as present`,
    )
  ).rows;
  if (table?.present === false) return false;
  if (table?.present !== true) throw Error("EMAIL_SUPPRESSION_CHECK_UNAVAILABLE");
  const ring = privacyKeys();
  const versions = Object.keys(ring.keys);
  const list = (values: string[]) =>
    sql`ARRAY[${sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    )}]::text[]`;
  const [answer] = (
    await executor.execute<{ suppressed: boolean }>(
      sql`select valo_email_address_suppressed(${list(versions)}, ${list(
        versions.map((version) => checksum(ring.keys[version]!, address)),
      )}) as suppressed`,
    )
  ).rows;
  if (typeof answer?.suppressed !== "boolean") throw Error("EMAIL_SUPPRESSION_CHECK_UNAVAILABLE");
  return answer.suppressed;
}
