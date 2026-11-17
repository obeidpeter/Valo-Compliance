import { sql, type SQL } from "drizzle-orm";
import { pgPolicy, pgRole, type PgColumn } from "drizzle-orm/pg-core";

/**
 * The role customer requests act as (`runInWorkspaceScope` in ../index.ts). It holds only the
 * table privileges customer requests use (WORKSPACE_SCOPE_PRIVILEGES in
 * lib/db/scripts/workspace-row-security.mjs), and row-level security limits it to the rows of
 * the workspace in `valo.workspace_id`. Migrations grant its privileges; drizzle-kit manages
 * neither the role nor its grants.
 */
export const workspaceScopeRole = pgRole("valo_workspace_scope").existing();

/** The workspace the current transaction acts in, or NULL, which matches no row. */
export const currentWorkspace = sql`nullif(current_setting('valo.workspace_id', true), '')::uuid`;

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
