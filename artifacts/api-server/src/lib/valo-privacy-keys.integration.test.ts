import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool, valoPrivacyEvents } from "@workspace/db";
import { privacySigner, privacyKey, privacyIdentityHashes, type PrivacyKeys } from "./valo-privacy-keys";
import { privacyAuditHash, privacyAuditEqual, type PrivacyAuditInput } from "./valo-privacy-state";
import { quotaSubjectHash } from "./valo-quota";
import { holdUnsentPrivacyNotifications } from "../modules/privacy/valo-privacy-erasure";
test(
  "isolated privacy signing-key rotation — no real secret rotation",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 30000,
  },
  async (t) => {
    const schema = `privacy_keys_${randomUUID().replaceAll("-", "")}`;
    const old = "SYNTHETIC-OLD-KEY-NOT-A-CREDENTIAL-".repeat(2),
      next = "SYNTHETIC-NEW-KEY-NOT-A-CREDENTIAL-".repeat(2);
    const before: PrivacyKeys = { current: "v1", keys: { v1: old, "session-derived-v1": old } };
    const after: PrivacyKeys = { current: "v2", keys: { ...before.keys, v2: next } };
    const event: PrivacyAuditInput = {
      workspaceId: randomUUID(),
      caseId: randomUUID(),
      sequence: 1,
      actorType: "customer",
      actorHash: "0".repeat(64),
      action: "controlled_legacy",
      reason: "Synthetic rotation fixture.",
      createdAt: new Date(),
      previousHash: "0".repeat(64),
      stateHash: "1".repeat(64),
      keyVersion: "session-derived-v1",
    };
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const run = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
        return fn(tx);
      });
    try {
      await run(async (tx) => {
        await tx.execute(
          sql`CREATE TABLE valo_privacy_key_versions(id text PRIMARY KEY,fingerprint text NOT NULL,pinned_at timestamptz DEFAULT now())`,
        );
        await tx.execute(sql`CREATE TABLE valo_privacy_events(id uuid PRIMARY KEY,workspace_id uuid,case_id uuid,sequence integer,
        actor_type text,actor_hash text,action text,reason text,previous_hash text,state_hash text,event_hash text,key_version text,created_at timestamptz)`);
        await tx.execute(sql`CREATE TABLE valo_privacy_tombstones(id uuid,key_version text)`);
        await tx.execute(
          sql`CREATE TABLE valo_purchase_outbox(id uuid,workspace_id uuid,status text,order_id uuid)`,
        );
        await tx
          .insert(valoPrivacyEvents)
          .values({ id: randomUUID(), ...event, eventHash: privacyAuditHash(event, old) });
        await tx.execute(
          sql`INSERT INTO valo_privacy_tombstones VALUES(${randomUUID()}::uuid,'session-derived-v1')`,
        );
      });
      await t.test("legacy version is pinned only after its retained signature verifies", async () => {
        await run(async (tx) => {
          const k = await privacyKey(tx, event.keyVersion, before);
          assert.equal(privacyAuditEqual(privacyAuditHash(event, k), privacyAuditHash(event, old)), true);
          const signer = await privacySigner(tx, before);
          assert.equal(signer.version, "v1");
        });
      });
      await t.test("new version signs while old and legacy signatures still verify", async () => {
        await run(async (tx) => {
          const signer = await privacySigner(tx, after);
          assert.equal(signer.version, "v2");
          const rotated = {
            ...event,
            sequence: 2,
            keyVersion: signer.version,
            previousHash: privacyAuditHash(event, old),
          };
          const signed = privacyAuditHash(rotated, signer.key);
          assert.equal(
            privacyAuditEqual(signed, privacyAuditHash(rotated, await privacyKey(tx, "v2", after))),
            true,
          );
          assert.equal(
            privacyAuditEqual(
              privacyAuditHash(event, old),
              privacyAuditHash(event, await privacyKey(tx, event.keyVersion, after)),
            ),
            true,
          );
          assert.equal(await privacyKey(tx, "v1", after), old);
          assert.ok(
            (await privacyIdentityHashes(tx, "synthetic-removed-identity", after)).includes(
              quotaSubjectHash(old, "user", "synthetic-removed-identity"),
            ),
          );
        });
      });
      await t.test(
        "missing historical material holds both history verification and identity matching",
        async () => {
          const missing: PrivacyKeys = { current: "v2", keys: { v2: next } };
          await assert.rejects(() => run((tx) => privacyKey(tx, event.keyVersion, missing)), { status: 503 });
          await assert.rejects(
            () => run((tx) => privacyIdentityHashes(tx, "synthetic-removed-identity", missing)),
            { status: 503 },
          );
        },
      );
      await t.test(
        "reusing a pinned version name with another key cannot silently re-sign history",
        async () => {
          const wrong: PrivacyKeys = { current: "v1", keys: { v1: next, "session-derived-v1": next } };
          await assert.rejects(() => run((tx) => privacySigner(tx, wrong)), { status: 503 });
          await assert.rejects(() => run((tx) => privacyKey(tx, event.keyVersion, wrong)), { status: 503 });
        },
      );
      await t.test(
        "unsent notices are held idempotently without rewriting accepted outcomes or another tenant",
        async () => {
          await run(async (tx) => {
            const a = randomUUID(),
              b = randomUUID();
            for (const status of [
              "awaiting_email_configuration",
              "pending",
              "retry",
              "accepted",
              "delivered",
              "unknown_outcome",
              "failed",
            ])
              await tx.execute(
                sql`INSERT INTO valo_purchase_outbox VALUES(${randomUUID()}::uuid,${a}::uuid,${status},${randomUUID()}::uuid)`,
              );
            await tx.execute(
              sql`INSERT INTO valo_purchase_outbox VALUES(${randomUUID()}::uuid,${b}::uuid,'pending',${randomUUID()}::uuid)`,
            );
            const before = await tx.execute<{
              id: string;
              status: string;
              workspace_id: string;
              order_id: string;
            }>(sql`SELECT * FROM valo_purchase_outbox ORDER BY id`);
            assert.equal((await holdUnsentPrivacyNotifications(tx, a)).rowCount, 3);
            assert.equal((await holdUnsentPrivacyNotifications(tx, a)).rowCount, 0);
            const afterRows = await tx.execute<{
              id: string;
              status: string;
              workspace_id: string;
              order_id: string;
            }>(sql`SELECT * FROM valo_purchase_outbox ORDER BY id`);
            for (let n = 0; n < before.rows.length; n++) {
              const old = before.rows[n],
                now = afterRows.rows[n];
              assert.ok(now);
              assert.ok(old);
              assert.equal(now.order_id, old.order_id);
              assert.equal(now.id, old.id);
              assert.equal(
                now.status,
                old.workspace_id === a &&
                  ["awaiting_email_configuration", "pending", "retry"].includes(old.status)
                  ? "held_privacy_erasure"
                  : old.status,
              );
            }
          });
        },
      );
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
