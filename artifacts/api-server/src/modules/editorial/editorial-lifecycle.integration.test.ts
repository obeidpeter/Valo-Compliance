import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { sql } from "drizzle-orm";
import { digest, evaluatePublication } from "@workspace/valo-core";
import { heldSourceBundle } from "../../lib/valo-source-controls.fixtures";
import { createLifecycleSandbox } from "./editorial-lifecycle-sandbox";

/** Drizzle reports database errors as "Failed query: ..." with the database's own error
 * as the cause; match the database message anywhere in that chain. */
const databaseMessage = (pattern: RegExp) => (error: unknown) => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const item = e as { message?: unknown; cause?: unknown };
    if (pattern.test(String(item.message ?? ""))) return true;
    e = item.cause;
  }
  return false;
};

test(
  "actual isolated PostgreSQL reviewer denies release/policy and retained sources reject mutation",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 30000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const configured = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname));
    const { db, pool } = await import("@workspace/db");
    const { evaluateEditorialPermissionDenials } = await import("./editorial-permission-evaluation");
    const id = randomUUID(),
      runId = randomUUID(),
      prefix = "synthetic-lifecycle-" + id,
      bundle = heldSourceBundle(new Date());
    assert.equal(
      evaluatePublication(bundle).decision,
      "hold",
      "No generated fixture is an accepted publication baseline",
    );
    try {
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${prefix},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
      );
      await db.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
   values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86400000)})`);
      await t.test(
        "both concrete roles deny function invocation and SQL mutation, preserving six current-run audit rows",
        async () => {
          const result = await evaluateEditorialPermissionDenials(id, runId);
          assert.equal(result.receipts.length, 6);
          assert.equal(new Set(result.receipts.map((x) => x.auditId)).size, 6);
          assert.equal(
            (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]!
              .status,
            "candidate",
          );
          await assert.rejects(
            db.execute(sql`delete from valo_publication_audit where id=${result.receipts[0]!.auditId}::uuid`),
            databaseMessage(/append-only/),
          );
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(sql`set local role valo_content_reviewer_dev`);
              await tx.execute(sql`select id from valo_documents limit 0`);
            }),
            (error) => {
              let e: unknown = error;
              for (let i = 0; i < 5 && e; i++) {
                const x = e as { code?: string; cause?: unknown };
                if (x.code === "42501") return true;
                e = x.cause;
              }
              return false;
            },
          );
        },
      );
      await t.test("complete source snapshots cannot be replaced or deleted", async () => {
        const snapshotId = randomUUID();
        await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,status,extraction_version,metadata)
    values(${snapshotId}::uuid,${prefix},'https://example.invalid/synthetic',now(),'failed','controlled-ci','{"synthetic":true}')`);
        await assert.rejects(
          db.execute(
            sql`update valo_source_snapshots set status='retrieved_unreviewed' where id=${snapshotId}::uuid`,
          ),
          databaseMessage(/append-only/),
        );
        await assert.rejects(
          db.execute(sql`delete from valo_source_snapshots where id=${snapshotId}::uuid`),
          databaseMessage(/append-only/),
        );
        assert.equal(
          (await db.execute(sql`select status from valo_source_snapshots where id=${snapshotId}::uuid`))
            .rows[0]!.status,
          "failed",
        );
      });
    } finally {
      await pool.end();
    }
  },
);

test(
  "lifecycle copy creates and drops only its own local database, preserving the prepared seed",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 30000,
  },
  async () => {
    const configured = new URL(process.env.DATABASE_URL!),
      seedName = "valo_lifecycle_seed_" + randomUUID().replaceAll("-", "");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname));
    const adminUrl = new URL(configured);
    adminUrl.pathname = "/postgres";
    const admin = new Pool({ connectionString: adminUrl.href, max: 1 }),
      seedUrl = new URL(configured);
    seedUrl.pathname = "/" + seedName;
    // Short-lived connections are single clients: a pool's end() resolves before its connections
    // close, and dropping or copying a database that still has one open fails or terminates it.
    const connect = async (url: string) => {
      const client = new Client({ connectionString: url });
      await client.connect();
      return client;
    };
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${seedName}"`);
      created = true;
      const seed = await connect(seedUrl.href);
      try {
        await seed.query("create table synthetic_seed_marker(value text not null)");
        await seed.query("insert into synthetic_seed_marker values('not a publication fixture')");
      } finally {
        await seed.end();
      }
      const copy = await createLifecycleSandbox(seedUrl.href, configured.href);
      try {
        const reader = await connect(copy.url);
        try {
          assert.equal(
            (await reader.query("select value from synthetic_seed_marker")).rows[0].value,
            "not a publication fixture",
          );
          await reader.query("delete from synthetic_seed_marker");
        } finally {
          await reader.end();
        }
      } finally {
        await copy.close();
      }
      assert.equal(
        (await admin.query("select count(*)::int n from pg_database where datname=$1", [copy.name])).rows[0]
          .n,
        0,
      );
      const verify = await connect(seedUrl.href);
      try {
        assert.equal((await verify.query("select count(*)::int n from synthetic_seed_marker")).rows[0].n, 1);
      } finally {
        await verify.end();
      }
    } finally {
      if (created) await admin.query(`DROP DATABASE "${seedName}" WITH (FORCE)`);
      await admin.end();
    }
  },
);
