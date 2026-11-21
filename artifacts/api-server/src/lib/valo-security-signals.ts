import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { currentWorkspaceScope, db } from "@workspace/db";
import { logger } from "../platform/logger";

/** SEC-008: the security events counted for the internal alerts (valo-operations.ts). */
export const SECURITY_SIGNAL_KINDS = ["denied_access", "signature_failure"] as const;
export type SecuritySignalKind = (typeof SECURITY_SIGNAL_KINDS)[number];

/**
 * Who caused a signal, as a keyed hash: the table never holds an address or identity. It uses the
 * key quota subjects use, under its own prefix, so the two hashes of one address differ.
 */
export function securitySubjectHash(secret: string | undefined, subjectKind: "ip" | "user", subject: string) {
  if (!secret || secret.length < 32 || !subject) throw new Error("SecuritySignalConfigurationUnavailable");
  return createHmac("sha256", secret).update(`valo:security:v1:${subjectKind}:${subject}`).digest("hex");
}

/**
 * Counts one signal in the current minute of the database clock. It runs on the application's own
 * connection, never in a workspace scope: the scoped role can neither read nor write signals, and a
 * customer request must not learn whether its refusals are counted. Rows expire after a day.
 */
export async function recordSecuritySignal(
  kind: SecuritySignalKind,
  subjectHash: string,
  executor: Pick<typeof db, "execute"> = db,
) {
  if (!SECURITY_SIGNAL_KINDS.includes(kind) || !/^[a-f0-9]{64}$/.test(subjectHash))
    throw new Error("InvalidSecuritySignal");
  if (currentWorkspaceScope() !== undefined) throw new Error("SecuritySignalInsideWorkspaceScope");
  await executor.execute(sql`
    WITH stamp AS (SELECT date_trunc('minute', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS started)
    INSERT INTO valo_security_signals (kind, subject_hash, window_started_at, count, expires_at)
    SELECT ${kind}, ${subjectHash}, started, 1, started + interval '1 day' FROM stamp
    ON CONFLICT (kind, subject_hash, window_started_at)
    DO UPDATE SET count = LEAST(valo_security_signals.count + 1, 1000000)
  `);
}

export async function purgeExpiredSecuritySignals(executor: Pick<typeof db, "execute"> = db) {
  await executor.execute(sql`DELETE FROM valo_security_signals WHERE expires_at < CURRENT_TIMESTAMP`);
}

const PURGE_INTERVAL_MS = 60_000;
let lastPurgeStartedAt = 0;
/** Expired rows never change an alert (the probes read recent minutes), so cleanup runs at most
 * once a minute per process and never delays a response. */
export function schedulePurgeExpiredSecuritySignals(now = Date.now()) {
  if (now - lastPurgeStartedAt < PURGE_INTERVAL_MS) return;
  lastPurgeStartedAt = now;
  void purgeExpiredSecuritySignals().catch((error: unknown) =>
    logger.warn({
      event: "security_signal.purge_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
}
