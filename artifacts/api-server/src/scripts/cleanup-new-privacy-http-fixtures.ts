import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
try {
  assertDevelopmentRuntime();
  if (process.env.VALO_CLEAN_NEW_PRIVACY_HTTP_FIXTURES !== "recorded-new-fixtures-only")
    throw Error("EXPLICIT_FIXTURE_CLEANUP_REQUIRED");
  const result = await db.transaction(async (tx) => {
    const found = await tx.execute<{ id: string; owner_identity_id: string }>(sql`
      SELECT DISTINCT w.id,w.owner_identity_id FROM valo_workspaces w
      JOIN valo_privacy_messages m ON m.workspace_id=w.id
      WHERE w.owner_identity_id LIKE 'synthetic-http-privacy-%'
      AND w.created_at>='2026-11-14T22:42:50Z'::timestamptz
      AND m.body='SYNTHETIC-PRIVATE-REPLY: remove the draft profile and generated files only.'`);
    for (const row of found.rows) {
      const tag = row.owner_identity_id.slice("synthetic-http-privacy-".length);
      if (!/^[a-f0-9-]{36}$/.test(tag)) throw Error("UNEXPECTED_FIXTURE_ID");
      const checked = await tx.execute<{ n: number }>(sql`SELECT
        (SELECT count(*) FROM valo_documents WHERE workspace_id=${row.id}::uuid)+
        (SELECT count(*) FROM valo_orders WHERE workspace_id=${row.id}::uuid)+
        (SELECT count(*) FROM valo_profile_versions WHERE workspace_id=${row.id}::uuid) AS n`);
      if (Number(checked.rows[0]?.n) !== 0) throw Error("UNEXPECTED_NON_HTTP_FIXTURE_CONTENT");
      for (const table of [
        "valo_privacy_messages",
        "valo_privacy_erasure_objects",
        "valo_privacy_events",
        "valo_privacy_tombstones",
        "valo_privacy_cases",
        "valo_support_tickets",
        "valo_events",
        "valo_memberships",
      ])
        await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE workspace_id=${row.id}::uuid`);
      for (const kind of ["privacy", "finance", "revoked", "stale"]) {
        const identity = `synthetic-http-${kind}-${tag}`;
        await tx.execute(sql`DELETE FROM valo_staff_access_audit WHERE actor_id=${identity}`);
        await tx.execute(sql`DELETE FROM valo_staff_assignments WHERE identity_id=${identity}`);
      }
      await tx.execute(sql`DELETE FROM valo_workspaces WHERE id=${row.id}::uuid`);
    }
    return {
      newOwnedFixturesRemoved: found.rows.length,
      externalCalls: 0,
      genuineUsageRemoved: false,
      ownerContentRemoved: false,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
