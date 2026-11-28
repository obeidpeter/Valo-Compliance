import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { readinessQueries } from "./valo-operations";
import { resolveWorkspace } from "../workspaces";
import { financeHeldFixture } from "../commerce/valo-finance-test-fixture";

/**
 * SEC-005 and SEC-008 (docs/architecture/alerts.md, part 2), on a real database: the readings of money,
 * of the drafting assistant's use and of whole-workspace copies count every workspace's rows of the last
 * hour, and no older one. Every row is synthetic, written in one transaction that is rolled back: its
 * clock stands still between the readings, and nothing it writes stays for the tests after it.
 */
const hex = (text: string) => createHash("sha256").update(text).digest("hex");
const NAMES = [
  "checkouts",
  "checkoutAmount",
  "refunds",
  "refundAmount",
  "aiSpend",
  "workspaceDownloads",
  "staffCopies",
] as const;

test(
  "the money, drafting assistant and whole-workspace readings count every workspace's rows of the last hour, and no older one",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    const first = await resolveWorkspace(`synthetic-activity-readings-${randomUUID()}`);
    const second = await resolveWorkspace(`synthetic-activity-readings-${randomUUID()}`);
    const version = await financeHeldFixture();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const readings = async () => {
        const values: Record<string, number> = {};
        for (const name of NAMES)
          values[name] = Number((await client.query(readinessQueries[name])).rows[0]!.value);
        return values as Record<(typeof NAMES)[number], number>;
      };
      /** The drafting assistant's drafts of the last hour that took from its allowance, and the allowance. */
      const spend = async () =>
        (
          await client.query<{ used: number; allowance: number }>(
            `SELECT (SELECT count(*) FROM valo_ai_drafts WHERE budget_reserved
                AND created_at > now() - interval '1 hour')::int AS used,
              COALESCE((public.valo_commercial_setting('drafting_daily_in_all'))::int, 120) AS allowance`,
          )
        ).rows[0]!;
      const before = await readings();
      const usedBefore = (await spend()).used;

      // Checkouts: two in one workspace and one in another, the last 59 minutes ago, coming to ₦3,550;
      // and one 61 minutes ago, which is not read.
      // An order is made with its price's own amount, so each amount read here has a price of its own.
      const priced = async (kobo: number) => {
        const priceId = randomUUID();
        await client.query(
          `INSERT INTO valo_prices (id, content_version_id, title, amount_kobo, licence_version, licence_text,
             tax_treatment, approval_reference, effective_from)
           VALUES ($1, $2, 'Synthetic: an activity reading', $3, 'synthetic-only',
             'Synthetic test only. No approved sale.', 'No tax assertion.',
             'CONTROLLED FIXTURE NOT COMMERCIAL APPROVAL', now())`,
          [priceId, version.id, kobo],
        );
        return priceId;
      };
      const line = {
        title: "Synthetic: an activity reading",
        contentVersionId: version.id,
        licenceVersion: "synthetic-only",
        licenceText: "Synthetic test only. No approved sale.",
        taxTreatment: "No tax assertion.",
      };
      const order = async (actor: { workspaceId: string; identityId: string }, kobo: number, ago: number) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO valo_orders (id, workspace_id, requested_by, reference, request_key, price_id, line,
             amount_kobo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(mins => $9))`,
          [
            id,
            actor.workspaceId,
            actor.identityId,
            `valo-test-${id}`,
            randomUUID(),
            await priced(kobo),
            line,
            kobo,
            ago,
          ],
        );
        return { id, workspaceId: actor.workspaceId };
      };
      const bought = await order(first, 100_000, 0);
      const another = await order(first, 250_000, 1);
      await order(second, 5_000, 59);
      const older = await order(second, 1_000_000, 61);

      // Refunds: two asked for in the last hour, one of them authorised for ₦500; and one asked for
      // three hours ago and authorised two hours ago, which is read as neither.
      const refund = async (
        bought: { id: string; workspaceId: string },
        kobo: number,
        askedAgo: number,
        authorisedAgo: number | null,
      ) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO valo_refund_requests (id, workspace_id, order_id, reason, status, amount_kobo, reference,
             authorised_by, authorised_at, created_at)
           VALUES ($1, $2, $3, 'Synthetic: a refund for an activity reading', $4, $5, $6, $7,
             CASE WHEN $8::int IS NULL THEN NULL ELSE now() - make_interval(mins => $8::int) END,
             now() - make_interval(mins => $9))`,
          [
            id,
            bought.workspaceId,
            bought.id,
            authorisedAgo === null ? "requested" : "authorised",
            kobo,
            `valo-refund-test-${id}`,
            authorisedAgo === null ? null : "synthetic-activity-readings-staff",
            authorisedAgo,
            askedAgo,
          ],
        );
      };
      await refund(bought, 50_000, 5, 1);
      await refund(another, 20_000, 30, null);
      await refund(older, 90_000, 180, 120);

      // Drafts: three that took from the drafting assistant's allowance, in two workspaces; one that did
      // not; and one two hours ago, which is not read.
      const draft = async (
        actor: { workspaceId: string; identityId: string },
        reserved: boolean,
        ago: number,
      ) =>
        client.query(
          `INSERT INTO valo_ai_drafts (id, workspace_id, actor_id, idempotency_key, input_hash, task, status,
             prompt_version, budget_reserved, preview, created_at)
           VALUES ($1, $2, $3, $4, $5, 'synthetic', 'synthetic', 'synthetic', $6, '{}', now() - make_interval(mins => $7))`,
          [randomUUID(), actor.workspaceId, actor.identityId, randomUUID(), hex(randomUUID()), reserved, ago],
        );
      await draft(first, true, 0);
      await draft(first, true, 10);
      await draft(second, true, 45);
      await draft(second, false, 0);
      await draft(first, true, 120);

      // Whole-workspace downloads: one asked for in each workspace, and one two hours ago.
      const download = (actor: { workspaceId: string; identityId: string }, ago: number) =>
        client.query(
          `INSERT INTO valo_workspace_exports (id, workspace_id, requester_id, request_key, status, expires_at,
             created_at)
           VALUES ($1, $2, $3, $4, 'cancelled', now() + interval '1 day', now() - make_interval(mins => $5))`,
          [randomUUID(), actor.workspaceId, actor.identityId, randomUUID(), ago],
        );
      await download(first, 0);
      await download(second, 20);
      await download(first, 120);

      // Staff copies: an export request whose data privacy staff prepared once in the last hour and once
      // two hours ago; the step that started it is not a copy.
      const caseId = randomUUID();
      // A privacy request is a support ticket too, under the same id.
      await client.query(
        `INSERT INTO valo_support_tickets (id, workspace_id, category, scope, contact_email, sharing_consent,
           consent_version)
         VALUES ($1, $2, 'privacy', 'Privacy request (export)', 'synthetic-activity-readings@example.invalid',
           false, 'synthetic')`,
        [caseId, first.workspaceId],
      );
      await client.query(
        `INSERT INTO valo_privacy_cases (id, workspace_id, requester_identity_id, kind, idempotency_key,
           payload_hash, message, last_event_hash)
         VALUES ($1, $2, $3, 'export', $4, $5, 'Synthetic: a copy of my workspace data, please.', $6)`,
        [caseId, first.workspaceId, first.identityId, randomUUID(), hex("payload"), hex("last")],
      );
      let sequence = 0;
      const event = (action: string, ago: number) =>
        client.query(
          `INSERT INTO valo_privacy_events (id, workspace_id, case_id, sequence, actor_type, actor_hash, action,
             reason, previous_hash, state_hash, event_hash, key_version, created_at)
           VALUES ($1, $2, $3, $4, 'staff', $5, $6, 'Synthetic: preparing the copy.', $7, $8, $9, 'synthetic',
             now() - make_interval(mins => $10))`,
          [
            randomUUID(),
            first.workspaceId,
            caseId,
            ++sequence,
            hex("synthetic-staff"),
            action,
            hex(`previous-${sequence}`),
            hex(`state-${sequence}`),
            hex(`event-${sequence}`),
            ago,
          ],
        );
      await event("application_export_prepared", 120);
      await event("application_export_started", 2);
      await event("application_export_prepared", 1);

      const after = await readings();
      assert.deepEqual(
        {
          checkouts: after.checkouts - before.checkouts,
          checkoutAmount: after.checkoutAmount - before.checkoutAmount,
          refunds: after.refunds - before.refunds,
          refundAmount: after.refundAmount - before.refundAmount,
          workspaceDownloads: after.workspaceDownloads - before.workspaceDownloads,
          staffCopies: after.staffCopies - before.staffCopies,
        },
        {
          checkouts: 3,
          checkoutAmount: 3_550,
          refunds: 2,
          refundAmount: 500,
          workspaceDownloads: 2,
          staffCopies: 1,
        },
      );
      // The drafting assistant's use is read in hundredths of its allowance in all.
      const { used, allowance } = await spend();
      assert.equal(used, usedBefore + 3);
      assert.ok(allowance > 0);
      assert.equal(after.aiSpend, Math.floor((100 * used) / allowance));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  },
);
