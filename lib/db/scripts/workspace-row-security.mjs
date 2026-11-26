// What keeps customer requests inside their workspace at the database (runInWorkspaceScope in
// lib/db/src/workspace-scope.ts): the scoped role, its privileges and every workspace table's
// policy. Checked against the catalog, so raw SQL tables count as much as schema tables.
// Run it directly to check the database in DATABASE_URL: it prints each gap and fails on any.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const WORKSPACE_SCOPE_ROLE = "valo_workspace_scope";
/** The login customer requests connect as; it may become the scoped role and nothing else. */
export const WORKSPACE_LOGIN_ROLE = "valo_workspace_login";

/** Tables whose rows belong to a workspace without a workspace_id column of their own. */
export const LINKED_WORKSPACE_TABLES = [
  "valo_workspaces",
  "valo_support_actions",
  "valo_support_events",
  "valo_support_escalations",
  "valo_payment_events",
];

/**
 * Everything customer requests may do as the scoped role, table by table; anything else is
 * refused. Derived from every query the customer routes can reach. A table that is not listed
 * gets nothing.
 *
 * - "lock": UPDATE held only because PostgreSQL lets a role lock rows (SELECT ... FOR SHARE or
 *   FOR UPDATE) only if it may update them. The valo_workspace_scope_lock_only trigger refuses
 *   every update the role attempts.
 * - "update(column)": the role may update that column only.
 */
export const WORKSPACE_SCOPE_PRIVILEGES = {
  valo_ai_drafts: "select insert update",
  valo_assessments: "select insert",
  valo_bundles: "select lock",
  valo_concern_messages: "select insert",
  valo_content_versions: "select lock",
  valo_correction_notices: "select",
  valo_dispute_actions: "select",
  valo_dispute_information: "select insert",
  valo_dispute_transitions: "select",
  valo_document_revisions: "select insert",
  valo_documents: "select insert update",
  valo_edition_notices: "select update(read_at)",
  valo_entitlements: "select insert update",
  valo_events: "select insert",
  valo_export_jobs: "select insert update",
  valo_export_objects: "select update",
  valo_export_requests: "select insert",
  valo_file_assets: "select delete lock",
  valo_inference_batches: "select lock",
  valo_memberships: "select lock",
  valo_orders: "select insert update",
  valo_payment_concern_events: "select insert",
  valo_payment_concerns: "select insert update",
  valo_payment_disputes: "select",
  valo_payment_events: "select",
  valo_payment_reconciliations: "select",
  valo_prices: "select lock",
  valo_privacy_cases: "select insert update",
  valo_privacy_events: "select insert",
  valo_privacy_key_versions: "select insert",
  valo_privacy_messages: "select insert",
  valo_privacy_redactions: "select",
  valo_privacy_tombstones: "select",
  valo_profile_versions: "select insert",
  valo_publication_policies: "select",
  valo_purchase_outbox: "select insert",
  valo_rate_buckets: "select insert update",
  valo_refund_requests: "select insert",
  valo_refund_transitions: "select insert",
  valo_reminder_outbox: "select insert update",
  valo_reminder_preferences: "select insert update",
  valo_rule_notices: "select update(read_at)",
  valo_rule_releases: "select",
  valo_safety_switches: "select",
  valo_saved_templates: "select insert delete",
  valo_source_impacts: "select",
  valo_source_release_bindings: "select",
  valo_source_watches: "select",
  valo_support_actions: "select insert",
  valo_support_cases: "select insert update",
  valo_support_escalations: "select",
  valo_support_events: "select insert",
  valo_support_messages: "select insert",
  valo_support_tickets: "select insert lock",
  valo_tasks: "select insert update",
  valo_workspace_export_attempts: "select update",
  valo_workspace_exports: "select insert update",
  valo_workspaces: "select update(profile_revision)",
};

/** Sequences behind identity columns of tables the scoped role inserts into. */
export const WORKSPACE_SCOPE_SEQUENCES = {};

/**
 * Functions that run as their owner and that the scoped role may call: a total customer code
 * needs across workspaces, and the only ways it may change the shared inference ledger.
 */
export const WORKSPACE_SCOPE_FUNCTIONS = [
  "valo_scope_workspace",
  "valo_live_manual_premium_versions",
  "valo_manual_purchased_file",
  "valo_workspace_holds_template",
  "valo_free_form_edition",
  "valo_premium_form_edition",
  "valo_document_form_text",
  "valo_live_manual_templates",
  "valo_free_library_edition",
  "valo_workspace_library_editions",
  "valo_workspace_document_editions",
  "valo_workspace_carried_editions",
  "valo_customer_ai_reservations",
  "valo_commercial_setting",
  "valo_order_terms_hold",
  "valo_bundle_editions",
  "valo_inference_batch_record_result",
  "valo_inference_budget_commit",
  "valo_inference_budget_lock",
];

export const LOCK_ONLY_TRIGGER = "valo_workspace_scope_lock_only";

/**
 * For tests on a connection that may become the scoped role: registers a short-lived key in
 * the current transaction and acts as the scoped role for `workspaceId` in that transaction,
 * as a customer request would (lib/db/src/workspace-scope.ts signs the same way).
 */
export async function enterWorkspaceScope(client, workspaceId) {
  const key = randomBytes(32),
    id = randomUUID(),
    block = Buffer.alloc(64);
  key.copy(block);
  const pad = (byte) => Buffer.from(block.map((b) => b ^ byte)).toString("hex");
  await client.query(
    "INSERT INTO valo_scope_keys(id,inner_pad,outer_pad,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [id, pad(0x36), pad(0x5c)],
  );
  const { pid, started } = (
    await client.query(
      "SELECT pg_backend_pid() AS pid, (extract(epoch FROM transaction_timestamp()) * 1000000)::bigint::text AS started",
    )
  ).rows[0];
  const mac = createHmac("sha256", key).update(`${workspaceId}:${pid}:${started}`).digest("hex");
  await client.query(
    "SELECT set_config('valo.workspace_credential',$1,true),set_config('role','valo_workspace_scope',true)",
    [`${workspaceId}:${id}:${mac}`],
  );
}

const TABLE_PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

/** Every way the scoped role could reach another workspace's rows; empty when there is none. */
export async function rowSecurityGaps(client) {
  return [...(await scopeRoleGaps(client)), ...(await loginGaps(client))].sort();
}

/**
 * The login must be a credential boundary: SQL on its connections can become the scoped role,
 * but never the application role, and holds nothing once it resets its role.
 */
async function loginGaps(client) {
  const gaps = [],
    login = WORKSPACE_LOGIN_ROLE,
    role = WORKSPACE_SCOPE_ROLE;
  const [attributes] = (
    await client.query(
      `SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication AS unsafe, rolinherit
      FROM pg_roles WHERE rolname=$1`,
      [login],
    )
  ).rows;
  if (!attributes) return [`${login} does not exist`];
  if (attributes.unsafe) gaps.push(`${login} can bypass row security or administer the database`);
  if (attributes.rolinherit) gaps.push(`${login} uses its roles' privileges without becoming them`);
  const grants = (
    await client.query(
      `SELECT r.rolname AS granted, s.rolname AS member FROM pg_auth_members m
      JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles s ON s.oid=m.member
      WHERE r.rolname IN ($1,$2) OR s.rolname=$2`,
      [role, login],
    )
  ).rows;
  if (!grants.some((g) => g.granted === role && g.member === login))
    gaps.push(`${login} cannot become ${role}`);
  for (const g of grants)
    if (!(g.granted === role && g.member === login))
      gaps.push(
        g.member === login
          ? `${login} is a member of ${g.granted}`
          : `${g.member} is a member of ${g.granted}`,
      );
  gaps.push(...(await creationGaps(client, login)));
  // Its own grants and objects anywhere, not what it would gain by becoming the scoped role.
  for (const object of await ownGrants(client, login))
    gaps.push(`${login} holds a privilege on ${object} itself`);
  return gaps;
}

/**
 * Schemas, and tables, columns and functions by schema, that `role` owns or holds a grant on
 * itself, as "schema" or "schema.name". Temporary schemas belong to live sessions.
 */
async function ownGrants(client, role) {
  const { rows } = await client.query(
    `WITH r AS (SELECT oid FROM pg_roles WHERE rolname=$1),
    objects AS (
      SELECT nspname AS schema, NULL::name AS name, nspowner AS owner, nspacl AS acl FROM pg_namespace
      UNION ALL SELECT n.nspname, c.relname, c.relowner, c.relacl
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      UNION ALL SELECT n.nspname, c.relname, NULL, a.attacl FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attacl IS NOT NULL
      UNION ALL SELECT n.nspname, p.proname, p.proowner, p.proacl
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace)
    SELECT DISTINCT schema, name FROM objects o WHERE schema !~ '^pg_(toast_)?temp_'
      AND (owner=(SELECT oid FROM r) OR EXISTS (SELECT 1 FROM aclexplode(o.acl) x WHERE x.grantee=(SELECT oid FROM r)))
    ORDER BY 1, 2`,
    [role],
  );
  return rows.map(({ schema, name }) => (name ? `${schema}.${name}` : schema));
}

/**
 * An object a customer connection creates in public, or in a schema of its own named like the
 * application role, would be found before the real one by the application's own queries.
 */
async function creationGaps(client, role) {
  const [can] = (
    await client.query(
      `SELECT has_schema_privilege($1,'public','CREATE') AS objects,
        has_database_privilege($1,current_database(),'CREATE') AS schemas`,
      [role],
    )
  ).rows;
  return [
    ...(can.objects ? [`${role} can create objects in public`] : []),
    ...(can.schemas ? [`${role} can create schemas`] : []),
  ];
}

async function scopeRoleGaps(client) {
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
  gaps.push(...(await creationGaps(client, role)));
  gaps.push(...(await privilegeGaps(client)));
  // The pinned lists cover public; elsewhere the role holds nothing.
  for (const object of await ownGrants(client, role))
    if (object !== "public" && !object.startsWith("public."))
      gaps.push(`${role} holds a privilege on ${object} outside public`);

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
      !own.qual?.includes("valo_scope_workspace()") ||
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
  return gaps;
}

/** The scoped role's grants, compared with the pinned lists above. */
async function privilegeGaps(client) {
  const gaps = [],
    role = WORKSPACE_SCOPE_ROLE;
  const expected = new Map(Object.entries(WORKSPACE_SCOPE_PRIVILEGES).map(([t, p]) => [t, p.split(" ")]));
  const tables = (
    await client.query(
      `SELECT c.relname,
        ${TABLE_PRIVILEGES.map((p) => `has_table_privilege($1,c.oid,'${p}') AS "${p}"`).join(",")},
        (SELECT coalesce(array_agg(a.attname || ':' || lower(x.privilege_type) ORDER BY a.attname,x.privilege_type),'{}')
          FROM pg_attribute a, aclexplode(a.attacl) x
          WHERE a.attrelid=c.oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1)) AS columns,
        EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid
          WHERE t.tgrelid=c.oid AND t.tgname=$2 AND t.tgenabled<>'D' AND f.proname='valo_refuse_scoped_update'
            AND t.tgtype=(1|2|16)) AS lock_only
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
      [role, LOCK_ONLY_TRIGGER],
    )
  ).rows;
  for (const table of tables) {
    const want = expected.get(table.relname) ?? [];
    expected.delete(table.relname);
    const has = TABLE_PRIVILEGES.filter((p) => table[p]);
    if (table.update && want.includes("lock") && !want.includes("update"))
      has[has.indexOf("update")] = "lock";
    for (const column of table.columns) {
      const [name, privilege] = column.split(":");
      has.push(`${privilege}(${name})`);
    }
    const actual = has.sort().join(" "),
      wanted = [...want].sort().join(" ");
    if (actual !== wanted)
      gaps.push(`${table.relname}: ${role} has ${actual || "no privileges"}, expected ${wanted || "none"}`);
    if (want.includes("lock") && !table.lock_only)
      gaps.push(`${table.relname}: no ${LOCK_ONLY_TRIGGER} trigger refusing the scoped role's updates`);
  }
  for (const table of expected.keys()) gaps.push(`${table}: listed for ${role} but not in the database`);

  const sequences = (
    await client.query(
      `SELECT c.relname, ${["usage", "select", "update"]
        .map((p) => `has_sequence_privilege($1,c.oid,'${p}') AS "${p}"`)
        .join(",")}
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'`,
      [role],
    )
  ).rows;
  for (const sequence of sequences) {
    const actual = ["usage", "select", "update"].filter((p) => sequence[p]).join(" "),
      wanted = WORKSPACE_SCOPE_SEQUENCES[sequence.relname] ?? "";
    if (actual !== wanted)
      gaps.push(
        `${sequence.relname}: ${role} has ${actual || "no privileges"}, expected ${wanted || "none"}`,
      );
  }

  // Tables and sequences created later must not reach the role without a reviewed grant.
  const defaults = await client.query(
    `SELECT d.defaclobjtype FROM pg_default_acl d, aclexplode(d.defaclacl) x
    WHERE x.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1)`,
    [role],
  );
  for (const { defaclobjtype } of defaults.rows)
    gaps.push(`default privileges grant ${role} access to new objects of type ${defaclobjtype}`);

  // A function that runs as its owner bypasses row security; the role may call only the
  // listed ones, and each must not trust the caller's search_path.
  const functions = (
    await client.query(
      `SELECT p.proname, p.prosecdef, has_function_privilege($1,p.oid,'EXECUTE') AS callable,
        has_function_privilege('public',p.oid,'EXECUTE') AS public,
        coalesce(array_to_string(p.proconfig,','),'') AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`,
      [role],
    )
  ).rows;
  for (const name of WORKSPACE_SCOPE_FUNCTIONS) {
    const f = functions.find((x) => x.proname === name);
    if (!f?.callable || !f.prosecdef) gaps.push(`${name}: ${role} cannot call it as its owner`);
    else if (f.public) gaps.push(`${name}: every role may call it`);
    else if (!/^search_path=pg_catalog, ?pg_temp$/.test(f.config))
      gaps.push(`${name}: it does not pin its search_path`);
  }
  for (const f of functions)
    if (f.prosecdef && f.callable && !WORKSPACE_SCOPE_FUNCTIONS.includes(f.proname))
      gaps.push(`${f.proname}: ${role} may call it, and it runs as its owner`);
  return gaps;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const gaps = await rowSecurityGaps(client);
    for (const gap of gaps) console.error(gap);
    console.log(gaps.length ? `${gaps.length} gap(s)` : "no gaps");
    process.exitCode = gaps.length ? 1 : 0;
  } finally {
    await client.end();
  }
}
