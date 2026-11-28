import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoEmailEvents,
  valoEmailSuppressions,
  valoReminderOutbox,
} from "@workspace/db";
import { ListRemindersResponse } from "@workspace/api-zod";
import type { WorkspaceActor } from "../workspaces";
import { createTask, listReminders, reminderInstant, saveReminderPreferences } from "../tasks/valo-tasks";
import { createResendReminderSender, reminderEmailConfiguration } from "../tasks/valo-reminder-resend";
import { processReminder, reconcileDueReminders } from "../tasks/valo-reminder-worker";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { messagesFixture } from "../../test-support/messages-fixture";
import type { Delivery } from "./email-events";
import type { MessageSender } from "./message-sender";
import {
  emailEventsReady,
  recordDeliveryReports,
  recordEmailEvent,
  reportsCanBeTaken,
} from "./valo-email-events";
import { addressSuppressed, SUPPRESSION_LASTS_MS } from "./valo-email-suppression";
import { dispatchMessage } from "./valo-message-dispatcher";
import { unsubscribeToken } from "./unsubscribe-token";

/**
 * Suppression (docs/architecture/messages.md, slice 2b), against the real database: synthetic workspaces,
 * orders, reminders and addresses, reports this test makes itself, and a mailer whose transport is the
 * test's own. No provider is called and no message reaches anyone.
 *
 * Other test files share this database, so the test moves its own rows' times and never the clock.
 */
test(
  "an address whose email service sent a message back for good, or marked one as spam, gets no more optional messages, and only its checksum is kept (WRK-003, WRK-004)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.equal(Boolean(process.env.VALO_PRIVACY_KEYRING), false, "must not replace a configured keyring");
    const { workspace, settled, row, setPause, restorePause } = await messagesFixture();
    const anAddress = () => `synthetic-suppression-${randomUUID()}@example.test`;
    /** A receipt's message of `actor`'s workspace, taken by a sender named as the provider. */
    async function taken(actor: WorkspaceActor) {
      const reference = randomUUID();
      const sender: MessageSender = { name: "resend", send: async () => ({ providerMessageId: reference }) };
      const { message } = await settled(actor);
      assert.equal(await dispatchMessage(actor.workspaceId, message.id, sender, new Date()), "accepted");
      return { id: message.id, reference };
    }
    const made: string[] = [];
    /** One report, kept as the webhook keeps it, with the address it was about. */
    async function report(
      delivery: Delivery,
      providerMessageId: string,
      address: string | null,
      about: { detail?: string; occurredAt?: Date } = {},
    ) {
      const eventKey = `msg_synthetic_${randomUUID()}`;
      made.push(eventKey);
      assert.equal(
        await recordEmailEvent(
          "resend",
          eventKey,
          {
            delivery,
            detail: about.detail ?? null,
            providerMessageId,
            occurredAt: about.occurredAt ?? new Date(),
          },
          address,
        ),
        "kept",
      );
      return eventKey;
    }
    const eventOf = async (eventKey: string) =>
      (await db.select().from(valoEmailEvents).where(eq(valoEmailEvents.eventKey, eventKey)))[0]!;
    const suppressionOf = async (addressHash: string) =>
      (
        await db
          .select()
          .from(valoEmailSuppressions)
          .where(eq(valoEmailSuppressions.addressHash, addressHash))
      )[0];
    /** Suppresses `address` as a permanent bounce of one of `actor`'s messages would, and gives its row. */
    async function suppress(actor: WorkspaceActor, address: string, occurredAt = new Date()) {
      const message = await taken(actor);
      const key = await report("bounced", message.reference, address, { detail: "PERMANENT", occurredAt });
      await recordDeliveryReports();
      return (await suppressionOf((await eventOf(key)).addressHash!))!;
    }
    const hashes: string[] = [];
    const guard = guardNestedConnections({ db, pool });
    try {
      await setPause(false);
      await t.test(
        "a permanent bounce or a complaint about a message Valo holds suppresses its address, and nothing else does",
        async () => {
          const a = await workspace();
          const bounced = anAddress(),
            complained = anAddress();
          const first = await taken(a),
            second = await taken(a);
          const bounceKey = await report("bounced", first.reference, bounced, { detail: "PERMANENT" });
          const complaintKey = await report("complained", second.reference, complained);
          // What the report keeps in place of the address: its checksum and the key's version.
          const kept = await eventOf(bounceKey);
          assert.match(kept.addressHash!, /^[a-f0-9]{64}$/);
          assert.ok(kept.addressKeyVersion);
          assert.doesNotMatch(JSON.stringify(kept), /example\.test|synthetic-suppression/);
          // Kept is not yet suppressed: the address is suppressed when the report is recorded.
          assert.equal(await addressSuppressed(bounced), false);
          await recordDeliveryReports();
          assert.equal(await addressSuppressed(bounced), true);
          assert.equal(await addressSuppressed(complained), true);
          // The same address, however it is typed.
          assert.equal(await addressSuppressed(`  ${bounced.toUpperCase()} `), true);
          const rowOf = async (key: string) => (await suppressionOf((await eventOf(key)).addressHash!))!;
          const bounce = await rowOf(bounceKey),
            complaint = await rowOf(complaintKey);
          hashes.push(bounce.addressHash, complaint.addressHash);
          assert.deepEqual([bounce.reason, complaint.reason], ["bounced", "complained"]);
          assert.equal(bounce.keyVersion, kept.addressKeyVersion);
          assert.equal(+bounce.expiresAt - +bounce.lastReportedAt, SUPPRESSION_LASTS_MS);
          assert.doesNotMatch(JSON.stringify([bounce, complaint]), /example\.test|synthetic-suppression/);
          // A delivery, a delay, a bounce the provider does not call permanent, and its own failure to
          // send: each is about an address that may be good.
          const third = await taken(a);
          const others = anAddress();
          const quiet = [
            await report("delivered", third.reference, others),
            await report("delayed", third.reference, others),
            await report("bounced", third.reference, others, { detail: "TEMPORARY" }),
            await report("bounced", third.reference, others, { detail: "UNDETERMINED" }),
            await report("undelivered", third.reference, others, { detail: "PROVIDER_FAILED" }),
          ];
          // A permanent bounce about no message of Valo's suppresses nothing, now or once it is settled.
          const stray = anAddress();
          const strayKey = await report("bounced", randomUUID(), stray, { detail: "PERMANENT" });
          await recordDeliveryReports();
          await db
            .update(valoEmailEvents)
            .set({ receivedAt: new Date(Date.now() - 61 * 60_000) })
            .where(eq(valoEmailEvents.eventKey, strayKey));
          await recordDeliveryReports();
          assert.equal((await eventOf(strayKey)).status, "unmatched");
          assert.equal(await addressSuppressed(others), false);
          assert.equal(await addressSuppressed(stray), false);
          // And no checksum was kept for a report that does not suppress.
          for (const key of quiet) assert.equal((await eventOf(key)).addressHash, null, key);
        },
      );

      await t.test(
        "a reminder to a suppressed address is cancelled with its reason and never handed to the provider, and another address still gets its own",
        async () => {
          const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
            now = new Date(+reminderInstant(due, 1) + 1);
          /**
           * A workspace with reminders on and one due, and the mailer its reminder would go out through.
           * `transport` is what stands in for the provider.
           */
          async function withReminder(
            address: string,
            transport: () => Response = () => Response.json({ id: randomUUID() }),
          ) {
            const actor = await workspace();
            await saveReminderPreferences(actor, { enabled: true, offsets: [1], expectedRevision: 0 });
            const task = await createTask(actor, {
              title: "Controlled reminder for the suppression test",
              notes: "Synthetic only",
              dueDate: due,
              dateConfirmed: true,
              assessmentId: null,
              ruleId: null,
            });
            const [reminder] = await db
              .select()
              .from(valoReminderOutbox)
              .where(eq(valoReminderOutbox.taskId, task.id));
            const env = {
              NODE_ENV: "development",
              VALO_EMAIL_MODE: "development-test",
              VALO_EMAIL_FROM: "synthetic-sender@example.test",
              VALO_EMAIL_TEST_RECIPIENT: address,
              VALO_TRUSTED_ORIGIN: "https://valo.example.test",
            };
            const calls: string[] = [];
            const sender = createResendReminderSender(
              reminderEmailConfiguration(env)!,
              async (_path, options) => {
                calls.push(options.body);
                return transport();
              },
              async () => address,
              // The real check, asked from inside the reminder's workspace scope.
              addressSuppressed,
              // The real link, under this run's own key.
              (about) =>
                unsubscribeToken({
                  consent: "reminders",
                  workspaceId: about.workspaceId,
                  recordId: about.reminderId,
                  identityId: about.identityId,
                }),
              env,
            );
            return { actor, reminder: reminder!, sender, calls };
          }
          const stopped = anAddress(),
            open = anAddress();
          hashes.push((await suppress(await workspace(), stopped)).addressHash);
          const refused = await withReminder(stopped);
          assert.equal(
            await processReminder(refused.actor.workspaceId, refused.reminder.id, refused.sender, now),
            "cancelled",
          );
          assert.deepEqual(refused.calls, [], "the provider was never called");
          const listed = ListRemindersResponse.parse(await listReminders(refused.actor)).find(
            (r) => r.id === refused.reminder.id,
          )!;
          assert.deepEqual(
            [listed.status, listed.reason, listed.nextAttemptAt, listed.delivery],
            ["cancelled", "EMAIL_ADDRESS_SUPPRESSED", null, null],
          );
          // The provider was never asked, so the reminder's row does not count a try.
          assert.deepEqual([listed.attempts, listed.lastAttemptAt], [0, null]);
          // It is over: another run does not try it again.
          await reconcileDueReminders(refused.sender, { workspaceId: refused.actor.workspaceId }, now);
          assert.deepEqual(refused.calls, []);
          assert.equal(
            (
              await db
                .select({ status: valoReminderOutbox.status })
                .from(valoReminderOutbox)
                .where(eq(valoReminderOutbox.id, refused.reminder.id))
            )[0]!.status,
            "cancelled",
          );
          // A reminder whose first try was not confirmed, and whose address is suppressed before the
          // next one: it is cancelled without another call, and still says what it said of the first try.
          const late = anAddress();
          const retried = await withReminder(late, () => {
            throw Error("SYNTHETIC_TRANSPORT_FAILURE");
          });
          assert.equal(
            await processReminder(retried.actor.workspaceId, retried.reminder.id, retried.sender, now),
            "failed",
          );
          assert.equal(retried.calls.length, 1);
          hashes.push((await suppress(await workspace(), late)).addressHash);
          assert.equal(
            await processReminder(
              retried.actor.workspaceId,
              retried.reminder.id,
              retried.sender,
              new Date(+now + 61_000),
            ),
            "cancelled",
          );
          assert.equal(retried.calls.length, 1, "the provider was not called again");
          const [afterRetry] = await db
            .select()
            .from(valoReminderOutbox)
            .where(eq(valoReminderOutbox.id, retried.reminder.id));
          assert.deepEqual(
            [
              afterRetry!.status,
              afterRetry!.reason,
              afterRetry!.attempts,
              afterRetry!.firstAttemptAt,
              afterRetry!.lastAttemptAt,
              afterRetry!.nextAttemptAt,
              afterRetry!.leaseToken,
            ],
            ["cancelled", "EMAIL_ADDRESS_SUPPRESSED", 1, now, now, null, null],
          );
          // An address nothing was reported about gets its reminder, through the same check.
          const sent = await withReminder(open);
          assert.equal(
            await processReminder(sent.actor.workspaceId, sent.reminder.id, sent.sender, now),
            "sent",
          );
          assert.equal(sent.calls.length, 1);
          // A necessary message is not an optional one: the member whose address is suppressed is
          // still owed the receipt, and it is still offered to a sender.
          const receipt = await taken(refused.actor);
          assert.equal((await row(receipt.id)).status, "accepted");
        },
      );

      await t.test(
        "a suppression lasts 180 days from the last report, a later report keeps it going, and then the address is tried again",
        async () => {
          const a = await workspace();
          const address = anAddress();
          // One moment for every time below: a time read again later would be a later time.
          const moment = Math.floor(Date.now() / 1000) * 1000;
          const days = (n: number) => new Date(moment - n * 24 * 60 * 60_000);
          const first = await suppress(a, address, days(100));
          hashes.push(first.addressHash);
          assert.deepEqual(
            [first.firstReportedAt, first.lastReportedAt, +first.expiresAt - +first.lastReportedAt],
            [days(100), days(100), SUPPRESSION_LASTS_MS],
          );
          assert.equal(await addressSuppressed(address), true);
          // A later report keeps it going from its own time, and an earlier one that arrives late
          // shortens nothing.
          const later = await suppress(a, address, days(10));
          assert.deepEqual(
            [later.id, later.firstReportedAt, later.lastReportedAt],
            [first.id, days(100), days(10)],
          );
          const late = await suppress(a, address, days(150));
          assert.deepEqual(
            [late.firstReportedAt, late.lastReportedAt, +late.expiresAt],
            [days(150), days(10), +days(10) + SUPPRESSION_LASTS_MS],
          );
          // Its time passes: the address is no longer suppressed, and the next run removes the row.
          await db
            .update(valoEmailSuppressions)
            .set({
              firstReportedAt: days(200),
              lastReportedAt: days(190),
              expiresAt: new Date(Date.now() - 60_000),
            })
            .where(eq(valoEmailSuppressions.id, first.id));
          assert.equal(await addressSuppressed(address), false);
          // Another test file's run may be the one that removes it: the row being gone is the fact.
          await recordDeliveryReports();
          assert.equal(await suppressionOf(first.addressHash), undefined);
        },
      );

      await t.test(
        "a checksum made under an earlier key still stops the address after the key is replaced",
        async () => {
          const a = await workspace();
          const address = anAddress();
          const run = randomUUID().replaceAll("-", "");
          const earlier = `synthetic-earlier-${run}`,
            current = `synthetic-current-${run}`;
          const keys = {
            [earlier]: `synthetic-earlier-key-${run}`,
            [current]: `synthetic-current-key-${run}`,
          };
          try {
            process.env.VALO_PRIVACY_KEYRING = JSON.stringify({
              current: earlier,
              keys: { [earlier]: keys[earlier] },
            });
            const under = await suppress(a, address);
            hashes.push(under.addressHash);
            assert.equal(under.keyVersion, earlier);
            // The key is replaced, and the earlier one is kept in the ring for what was made under it.
            process.env.VALO_PRIVACY_KEYRING = JSON.stringify({ current, keys });
            assert.equal(await addressSuppressed(address), true);
            // A new report about the same address is kept under the current key, beside the earlier one.
            const again = await suppress(a, address);
            hashes.push(again.addressHash);
            assert.equal(again.keyVersion, current);
            assert.notEqual(again.addressHash, under.addressHash);
            assert.equal(await addressSuppressed(address), true);
          } finally {
            delete process.env.VALO_PRIVACY_KEYRING;
            // The two key versions this test pinned, which no other record names.
            await db.execute(sql`DELETE FROM valo_privacy_key_versions WHERE id IN (${earlier}, ${current})`);
          }
          // Under a key that made neither checksum, the address is not found.
          assert.equal(await addressSuppressed(address), false);
        },
      );

      await t.test(
        "a customer request can ask only whether an address is suppressed, and cannot read or write the list",
        async () => {
          const a = await workspace();
          const address = anAddress();
          hashes.push((await suppress(a, address)).addressHash);
          const inScope = <T>(run: () => Promise<T>) => runInWorkspaceScope(a.workspaceId, run);
          const denied = (error: Error) =>
            /permission denied for table valo_email_suppressions/.test(
              String((error as { cause?: Error }).cause?.message ?? error.message),
            );
          assert.equal(await inScope(() => addressSuppressed(address)), true);
          assert.equal(await inScope(() => addressSuppressed(anAddress())), false);
          await assert.rejects(
            inScope(async () => await db.select().from(valoEmailSuppressions)),
            denied,
          );
          await assert.rejects(
            inScope(async () => await db.delete(valoEmailSuppressions)),
            denied,
          );
          assert.equal(await addressSuppressed(address), true);
        },
      );

      await t.test(
        "where the suppression table is not there yet, no report is taken and no address is suppressed, so sending goes on as before; a check that cannot be made is not an answer",
        async () => {
          const address = anAddress();
          hashes.push((await suppress(await workspace(), address)).addressHash);
          // The database as it is before the first suppression migration: the table under another
          // name, for this transaction alone, which is then undone. Nothing else sees the change.
          const undone = Error("SYNTHETIC_ROLLBACK");
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.execute(
                sql`alter table valo_email_suppressions rename to valo_email_suppressions_absent`,
              );
              // The delivery tables are there, and what they hold is still read.
              assert.equal(await emailEventsReady(tx), true);
              assert.equal(await reportsCanBeTaken(tx), false);
              // Where no report is taken, nothing can have been suppressed: the address is not.
              assert.equal(await addressSuppressed(address, tx), false);
              throw undone;
            }),
            (error) => error === undone,
          );
          assert.equal(await reportsCanBeTaken(db), true);
          assert.equal(await addressSuppressed(address), true);
          // The table without its function, which is one migration of the two: the check fails, and
          // whoever asked sends nothing.
          let asked = 0;
          const half = {
            execute: async () => {
              if (asked++ === 0) return { rows: [{ present: true }] };
              throw Error("function valo_email_address_suppressed(text[], text[]) does not exist");
            },
          };
          await assert.rejects(addressSuppressed(address, half as never), /does not exist/);
          assert.equal(asked, 2);
          // An answer that is neither yes nor no is no answer.
          for (const rows of [[], [{}], [{ present: null }], [{ present: true }]])
            await assert.rejects(
              addressSuppressed(address, { execute: async () => ({ rows }) } as never),
              /EMAIL_SUPPRESSION_CHECK_UNAVAILABLE/,
              JSON.stringify(rows),
            );
        },
      );
    } finally {
      guard.restore();
      await restorePause();
      // This test's own reports and suppressions, whatever became of them.
      if (made.length) await db.delete(valoEmailEvents).where(inArray(valoEmailEvents.eventKey, made));
      if (hashes.length)
        await db.delete(valoEmailSuppressions).where(inArray(valoEmailSuppressions.addressHash, hashes));
      await pool.end();
    }
  },
);
