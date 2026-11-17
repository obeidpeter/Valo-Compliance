import { sql, type SQL } from "drizzle-orm";
import { check, pgPolicy, pgRole, pgTable, text, timestamp, uuid, type PgColumn } from "drizzle-orm/pg-core";

/**
 * The role customer requests act as (`runInWorkspaceScope` in ../workspace-scope.ts). It holds
 * only the table privileges customer requests use (WORKSPACE_SCOPE_PRIVILEGES in
 * lib/db/scripts/workspace-row-security.mjs), and row-level security limits it to the rows of
 * the workspace its transaction's credential names. Migrations grant its privileges;
 * drizzle-kit manages neither the role nor its grants.
 */
export const workspaceScopeRole = pgRole("valo_workspace_scope").existing();

/**
 * The workspace the current transaction acts in, or NULL, which matches no row. It comes from
 * the transaction's signed credential (valo.workspace_credential), which valo_scope_workspace()
 * checks against the issuing process's key, this database backend and this transaction, so
 * SQL on a customer connection cannot choose another workspace. Evaluated once per query.
 */
export const currentWorkspace = sql`(select valo_scope_workspace())`;

/**
 * Keys that application processes sign workspace credentials with, stored as HMAC-SHA256's
 * inner and outer key blocks. Only the application role may read or write them.
 */
export const valoScopeKeys = pgTable(
  "valo_scope_keys",
  {
    id: uuid("id").primaryKey(),
    innerPad: text("inner_pad").notNull(),
    outerPad: text("outer_pad").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "valo_scope_keys_pads_check",
      sql`${t.innerPad} ~ '^[0-9a-f]{128}$' AND ${t.outerPad} ~ '^[0-9a-f]{128}$'`,
    ),
    check("valo_scope_keys_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/** Limits the scoped role to rows whose `workspace` column is the current workspace. */
export const workspaceRowPolicy = (workspace: PgColumn) =>
  pgPolicy("valo_workspace_scope", {
    as: "permissive",
    for: "all",
    to: workspaceScopeRole,
    using: sql`${workspace} = ${currentWorkspace}`,
    withCheck: sql`${workspace} = ${currentWorkspace}`,
  });

/** Limits the scoped role to rows whose support case belongs to the current workspace. */
export const supportCaseRowPolicy = (caseId: PgColumn) =>
  pgPolicy("valo_workspace_scope", {
    as: "permissive",
    for: "all",
    to: workspaceScopeRole,
    using: sql`exists (select 1 from valo_support_cases c where c.id = ${caseId} and c.workspace_id = ${currentWorkspace})`,
    withCheck: sql`exists (select 1 from valo_support_cases c where c.id = ${caseId} and c.workspace_id = ${currentWorkspace})`,
  });

/** Limits the scoped role to rows that `owned` ties to the current workspace. */
export const linkedRowPolicy = (owned: SQL) =>
  pgPolicy("valo_workspace_scope", {
    as: "permissive",
    for: "all",
    to: workspaceScopeRole,
    using: owned,
    withCheck: owned,
  });
