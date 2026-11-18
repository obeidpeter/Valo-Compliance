import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, primaryKey, index, check } from "drizzle-orm/pg-core";

/**
 * SEC-008: how many security events of each kind one pseudonymous subject caused in each minute,
 * for the internal alerts. It holds no request content, address or identity: the subject is a
 * keyed hash, as quota subjects are. It holds no workspace rows, and the workspace scope has no
 * access to it; only the application role writes it, outside any workspace scope. Rows expire a
 * day after their minute.
 */
export const valoSecuritySignals = pgTable(
  "valo_security_signals",
  {
    kind: text("kind").notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.subjectHash, t.windowStartedAt] }),
    index("valo_security_signals_expiry_idx").on(t.expiresAt),
    check("valo_security_signals_kind_check", sql`${t.kind} IN ('denied_access', 'signature_failure')`),
    check("valo_security_signals_count_check", sql`${t.count} > 0`),
    check("valo_security_signals_subject_hash_check", sql`${t.subjectHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
export type ValoSecuritySignal = typeof valoSecuritySignals.$inferSelect;
