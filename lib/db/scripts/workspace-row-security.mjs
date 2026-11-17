// What keeps customer requests inside their workspace at the database (runInWorkspaceScope in
// lib/db/src/workspace-scope.ts): the scoped role, its privileges and every workspace table's
// policy. Checked against the catalog, so raw SQL tables count as much as schema tables.

export const WORKSPACE_SCOPE_ROLE = "valo_workspace_scope";

/** Tables whose rows belong to a workspace without a workspace_id column of their own. */
export const LINKED_WORKSPACE_TABLES = [
  "valo_workspaces",
  "valo_support_actions",
  "valo_support_events",
  "valo_support_escalations",
];

/** Every way the scoped role could reach another workspace's rows; empty when there is none. */
export async function rowSecurityGaps(client) {
  const gaps = [],
    role = WORKSPACE_SCOPE_ROLE;
  const [attributes] = (
    await client.query(
      `SELECT rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication AS unsafe
      FROM pg_roles WHERE rolname=$1`,
      [role],
    )
  ).rows;
  if (!attributes) return [`${role} does not exist`];
  if (attributes.unsafe) gaps.push(`${role} can log in, bypass row security or administer the database`);
  const memberships = await client.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles s ON s.oid=m.member WHERE s.rolname=$1`,
    [role],
  );
  for (const { rolname } of memberships.rows) gaps.push(`${role} is a member of ${rolname}`);
  if (
    (await client.query("SELECT has_schema_privilege($1,'public','CREATE') AS create", [role])).rows[0].create
  )
    gaps.push(`${role} can create objects in public`);
  const privileged = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (has_table_privilege($1,c.oid,'TRUNCATE')
      OR has_table_privilege($1,c.oid,'REFERENCES') OR has_table_privilege($1,c.oid,'TRIGGER'))`,
    [role],
  );
  for (const { relname } of privileged.rows)
    gaps.push(`${relname}: ${role} can truncate, reference or trigger`);

  const tables = await client.query(
    `SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (c.relname=ANY($1) OR EXISTS (SELECT 1 FROM pg_attribute a
      WHERE a.attrelid=c.oid AND a.attname='workspace_id' AND NOT a.attisdropped))`,
    [LINKED_WORKSPACE_TABLES],
  );
  const policies = (
    await client.query(
      `SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies
      WHERE schemaname='public'`,
    )
  ).rows;
  for (const { relname, relrowsecurity } of tables.rows) {
    if (!relrowsecurity) gaps.push(`${relname}: row security is off`);
    const own = policies.find((p) => p.tablename === relname && p.policyname === role);
    if (
      !own ||
      own.permissive !== "PERMISSIVE" ||
      own.cmd !== "ALL" ||
      own.roles.join() !== role ||
      !own.qual?.includes("valo.workspace_id") ||
      own.with_check !== own.qual
    )
      gaps.push(`${relname}: no policy limiting ${role} to the current workspace for reads and writes`);
  }
  // Permissive policies combine with OR, so any other policy could only widen access.
  for (const p of policies)
    if (p.policyname !== role || p.roles.join() !== role)
      gaps.push(
        `${p.tablename}: policy ${p.policyname} for ${p.roles.join(", ")} is not the workspace policy`,
      );
  return gaps.sort();
}
