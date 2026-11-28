import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoCorrectionNotices,
  valoEditionNotices,
  valoMessages,
  valoNoticeDigests,
  valoPrivacyTombstones,
  valoRuleNotices,
  valoSourceImpacts,
} from "@workspace/db";
import { ListWorkspaceMessagesResponse } from "@workspace/api-zod";
import { privacySigner } from "../../lib/valo-privacy-keys";
import { quotaSubjectHash } from "../../lib/valo-quota";
import type { WorkspaceActor } from "../workspaces";
import { workspaceDataExport } from "../privacy/valo-customer-access";
import { guardNestedConnections } from "../../test-support/nested-connection-guard";
import { messagesFixture } from "../../test-support/messages-fixture";
import { runMessagesJob } from "./messages-job";
import { standInSender } from "./message-sender";
import { lagosDate } from "./message-text";
import { recordDeliveryReports } from "./valo-email-events";
import { dispatchDueMessages } from "./valo-message-dispatcher";
import { listWorkspaceMessages } from "./valo-message-log";
import { dayNotices, noticeDigestsReady, oweNoticeDigests } from "./valo-notice-digests";

const DAY_MS = 24 * 60 * 60_000;
/** An instant on a Lagos clock, which is an hour ahead of UTC all year. */
const lagos = (day: string, time: string) => new Date(`${day}T${time}+01:00`);
/** The Lagos day `days` after `day`. */
const plus = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const lagosDayOf = (instant: Date) => new Date(+instant + 60 * 60_000).toISOString().slice(0, 10);
const subjectOf = (day: string) => `Changes on ${lagosDate(day)} that affect your Valo workspace`;

/**
 * A day's notices by email (docs/architecture/messages.md, slice 5), against the real database: synthetic
 * workspaces and notices, the stand-in sender, and no real message to anyone.
 *
 * The test gives each notice its time and each run its clock, and never moves the database's. Its days
 * are in the past, so each has ended by the database's own clock too. Every run is kept to one workspace
 * but the last case's, whose days are a month back, where no other test's notices are.
 */
test(
  "a day's notices owe a workspace one message, from 07:00 the next morning on a Lagos clock, naming what changed (EDP-011, WRK-004)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const fixture = await messagesFixture();
    const { messageOf, row, setPause, restorePause } = fixture;
    const made: string[] = [];
    async function workspace() {
      const actor = await fixture.workspace();
      made.push(actor.workspaceId);
      return actor;
    }
    /** The day the cases' notices are made on: four days ago, so the mornings after it have passed. */
    const R = plus(lagosDayOf(new Date()), -4);
    const morning = (day: string) => lagos(plus(day, 1), "07:00:00");
    const ruleNotice = (
      actor: WorkspaceActor,
      at: Date,
      title: string,
      kind: "replaced" | "withdrawn" = "withdrawn",
    ) =>
      db.insert(valoRuleNotices).values({
        workspaceId: actor.workspaceId,
        ruleId: `SYNTHETIC-NOTICES-${randomUUID()}`,
        version: 1,
        kind,
        replacementVersion: kind === "replaced" ? 2 : null,
        title,
        reason: "Synthetic change for the notices test.",
        results: 1,
        tasks: 0,
        createdAt: at,
      });
    const templateNotice = (
      actor: WorkspaceActor,
      at: Date,
      title: string,
      kind: "replaced" | "withdrawn" = "withdrawn",
    ) =>
      db.insert(valoEditionNotices).values({
        workspaceId: actor.workspaceId,
        route: "library",
        edition: randomUUID(),
        kind,
        title,
        version: 1,
        replacementVersion: kind === "replaced" ? 2 : null,
        reason: kind === "withdrawn" ? "Synthetic withdrawal for the notices test." : null,
        held: true,
        documents: 0,
        createdAt: at,
      });
    /** A change to a version no rule or template has: it reaches nothing but the notices made for it here. */
    async function impact() {
      const id = randomUUID();
      await db.insert(valoSourceImpacts).values({
        id,
        dedupeKey: `synthetic-notices-test:${id}`,
        targetKind: "rule",
        targetId: randomUUID(),
        targetKey: "SYNTHETIC-NOTICES-RULE",
        targetVersion: 1,
        reason: "Synthetic hold for the notices test.",
        actorId: "synthetic-notices-test",
        action: "hold",
        phase: "complete",
        completedAt: new Date(),
      });
      return id;
    }
    const correctionNotice = (
      actor: WorkspaceActor,
      at: Date,
      impactId: string,
      item = { kind: "tasks", id: randomUUID() },
    ) =>
      db.insert(valoCorrectionNotices).values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        impactId,
        entityKind: item.kind,
        entityId: item.id,
        message: "Synthetic correction notice for the notices test.",
        createdAt: at,
      });
    const digestsOf = (actor: WorkspaceActor) =>
      db
        .select()
        .from(valoNoticeDigests)
        .where(eq(valoNoticeDigests.workspaceId, actor.workspaceId))
        .orderBy(valoNoticeDigests.day);
    const noticeMessagesOf = (actor: WorkspaceActor) =>
      db
        .select()
        .from(valoMessages)
        .where(and(eq(valoMessages.workspaceId, actor.workspaceId), eq(valoMessages.kind, "notices_digest")));
    /** The one day recorded for a workspace, with its message. */
    async function owedDay(actor: WorkspaceActor) {
      const digests = await digestsOf(actor);
      assert.equal(digests.length, 1, "one day recorded");
      return { digest: digests[0]!, message: await messageOf("notices_digest", digests[0]!.id) };
    }
    // Inside a transaction, the notices' bookkeeping and the dispatcher use only that transaction's connection.
    const guard = guardNestedConnections({ db, pool });
    try {
      await setPause(false);
      await t.test(
        "a day's notices owe the workspace's owner one message from 07:00 the next morning and not before; a second run, or several at once, adds none, and the next day's notices owe their own",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          await ruleNotice(a, lagos(R, "00:00:00"), "Synthetic rule: the day's first");
          await ruleNotice(a, lagos(R, "23:59:59"), "Synthetic rule: the day's last");
          await ruleNotice(a, lagos(plus(R, 1), "00:00:00"), "Synthetic rule: the next day's");
          // The day itself, then the night after it: nothing is owed until 07:00.
          for (const at of [
            lagos(R, "23:59:59"),
            lagos(plus(R, 1), "00:00:00"),
            lagos(plus(R, 1), "06:59:59"),
          ])
            assert.deepEqual(await oweNoticeDigests(at, inA), { owed: 0 });
          assert.equal((await digestsOf(a)).length, 0);
          assert.equal((await noticeMessagesOf(a)).length, 0);
          // From 07:00, once, however many runs there are.
          const runs = await Promise.all(Array.from({ length: 4 }, () => oweNoticeDigests(morning(R), inA)));
          assert.equal(
            runs.reduce((owed, run) => owed + run.owed, 0),
            1,
          );
          assert.deepEqual(await oweNoticeDigests(lagos(plus(R, 1), "23:00:00"), inA), { owed: 0 });
          const { digest, message } = await owedDay(a);
          assert.equal(digest.day, R);
          assert.deepEqual(
            {
              workspaceId: message.workspaceId,
              class: message.class,
              recipient: message.recipientIdentityId,
              status: message.status,
              attempts: message.attempts,
            },
            {
              workspaceId: a.workspaceId,
              class: "necessary",
              recipient: a.identityId,
              status: "queued",
              attempts: 0,
            },
          );
          // The next day's notice was not that day's, and owes a message of its own the morning after.
          assert.deepEqual(await oweNoticeDigests(morning(plus(R, 1)), inA), { owed: 1 });
          assert.deepEqual(
            (await digestsOf(a)).map((d) => d.day),
            [R, plus(R, 1)],
          );
          assert.equal((await noticeMessagesOf(a)).length, 2);
        },
      );

      await t.test(
        "a correction, a changed requirement and a withdrawn template are emailed; a template replaced by a later edition is shown in the app only",
        async () => {
          const owes = async (actor: WorkspaceActor) =>
            (await oweNoticeDigests(morning(R), { workspaceId: actor.workspaceId })).owed;
          const replacedTemplate = await workspace();
          await templateNotice(replacedTemplate, lagos(R, "10:00:00"), "Synthetic template", "replaced");
          assert.equal(await owes(replacedTemplate), 0);
          assert.equal((await digestsOf(replacedTemplate)).length, 0);
          const withdrawnTemplate = await workspace();
          await templateNotice(withdrawnTemplate, lagos(R, "10:00:00"), "Synthetic template", "withdrawn");
          assert.equal(await owes(withdrawnTemplate), 1);
          for (const kind of ["replaced", "withdrawn"] as const) {
            const changedRule = await workspace();
            await ruleNotice(changedRule, lagos(R, "10:00:00"), "Synthetic rule", kind);
            assert.equal(await owes(changedRule), 1, kind);
          }
          const corrected = await workspace();
          await correctionNotice(corrected, lagos(R, "10:00:00"), await impact());
          assert.equal(await owes(corrected), 1);
          assert.equal((await owedDay(corrected)).digest.day, R);
        },
      );

      await t.test(
        "the message names the day's changes as they are when it is sent, counts the saved items to review once each, and names nothing of another day or of a replaced template",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          await ruleNotice(a, lagos(R, "09:00:00"), "Synthetic rule: annual return", "replaced");
          await ruleNotice(a, lagos(R, "10:00:00"), "Synthetic rule: food product", "withdrawn");
          await templateNotice(a, lagos(R, "11:00:00"), "Synthetic template: withdrawn pack", "withdrawn");
          await templateNotice(a, lagos(R, "12:00:00"), "Synthetic template: replaced pack", "replaced");
          // One task that two changes reached, and one document: two saved items, three notices.
          const first = await impact(),
            second = await impact(),
            task = { kind: "tasks", id: randomUUID() };
          await correctionNotice(a, lagos(R, "13:00:00"), first, task);
          await correctionNotice(a, lagos(R, "13:05:00"), second, task);
          await correctionNotice(a, lagos(R, "14:00:00"), first, { kind: "documents", id: randomUUID() });
          await ruleNotice(a, lagos(plus(R, -1), "23:59:59"), "Synthetic rule: the day before's");
          await ruleNotice(a, lagos(plus(R, 1), "00:00:00"), "Synthetic rule: the day after's");
          // The day before's notice owes its own message; the day after's is not yet owed.
          assert.deepEqual(await oweNoticeDigests(morning(R), inA), { owed: 2 });
          const sender = standInSender({ keep: true });
          assert.equal((await dispatchDueMessages(sender, new Date(), inA)).offered, 2);
          const ofDay = (day: string) => sender.kept.filter((m) => m.subject === subjectOf(day));
          assert.equal(ofDay(R).length, 1);
          assert.equal(ofDay(plus(R, -1)).length, 1);
          const message = ofDay(R)[0]!;
          assert.equal(message.kind, "notices_digest");
          assert.deepEqual(message.recipient, { identityId: a.identityId });
          const lines = message.text.split("\n");
          assert.deepEqual(lines.slice(0, 11), [
            `On ${lagosDate(R)} Valo recorded changes that affect what you saved, made or bought in your workspace.`,
            "",
            "Requirements Valo checks:",
            "- Replaced by a later version: Synthetic rule: annual return",
            "- Withdrawn: Synthetic rule: food product",
            "",
            "Templates:",
            "- Withdrawn: Synthetic template: withdrawn pack",
            "",
            "Saved items to review:",
            "- 2 of your tasks, saved results, documents or purchases used a source or a version that is now held or withdrawn. What you saved and the files you made are unchanged.",
          ]);
          assert.ok(lines[12]!.startsWith("Each change, and what it affects, is on your workspace page: "));
          for (const absent of ["replaced pack", "the day before's", "the day after's", "@"])
            assert.ok(!message.text.includes(absent), absent);
          assert.ok(ofDay(plus(R, -1))[0]!.text.includes("- Withdrawn: Synthetic rule: the day before's"));
          assert.ok(!ofDay(plus(R, -1))[0]!.text.includes("annual return"));
          // The stand-in took it: accepted by a sender that sends nothing, and never called delivered.
          const after = await row(message.messageId);
          assert.deepEqual([after.status, after.sender, after.attempts], ["accepted", "stand-in", 1]);

          // More of a sort than a message names are counted.
          const many = await workspace();
          for (let i = 0; i < 12; i++)
            await ruleNotice(
              many,
              lagos(R, `08:${String(i).padStart(2, "0")}:00`),
              `Synthetic rule ${i + 1}`,
            );
          for (let i = 0; i < 11; i++)
            await templateNotice(
              many,
              lagos(R, `09:${String(i).padStart(2, "0")}:00`),
              `Synthetic template ${i + 1}`,
            );
          assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: many.workspaceId }), {
            owed: 1,
          });
          const kept = standInSender({ keep: true });
          await dispatchDueMessages(kept, new Date(), { workspaceId: many.workspaceId });
          const named = kept.kept[0]!.text.split("\n").filter((line) => line.startsWith("- "));
          assert.deepEqual(named, [
            ...Array.from({ length: 10 }, (_, i) => `- Withdrawn: Synthetic rule ${i + 1}`),
            "- and 2 more requirements",
            ...Array.from({ length: 10 }, (_, i) => `- Withdrawn: Synthetic template ${i + 1}`),
            "- and 1 more template",
          ]);
        },
      );

      await t.test(
        "a day with no notice left, or whose record is gone, owes no message any more, and no sender is handed one",
        async () => {
          const gone = await workspace(),
            unrecorded = await workspace();
          for (const actor of [gone, unrecorded]) {
            await ruleNotice(actor, lagos(R, "10:00:00"), "Synthetic rule");
            assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: actor.workspaceId }), {
              owed: 1,
            });
          }
          const sender = standInSender({ keep: true });
          await db.delete(valoRuleNotices).where(eq(valoRuleNotices.workspaceId, gone.workspaceId));
          const first = await owedDay(gone);
          assert.equal(
            (await dispatchDueMessages(sender, new Date(), { workspaceId: gone.workspaceId })).offered,
            0,
          );
          assert.deepEqual(
            [(await row(first.message.id)).status, (await row(first.message.id)).reason],
            ["cancelled", "NOTICES_NOT_FOUND"],
          );
          const second = await owedDay(unrecorded);
          await db.delete(valoNoticeDigests).where(eq(valoNoticeDigests.id, second.digest.id));
          assert.equal(
            (await dispatchDueMessages(sender, new Date(), { workspaceId: unrecorded.workspaceId })).offered,
            0,
          );
          assert.deepEqual(
            [(await row(second.message.id)).status, (await row(second.message.id)).reason],
            ["cancelled", "RECORD_NOT_FOUND"],
          );
          assert.equal(sender.kept.length, 0);
        },
      );

      await t.test(
        "a workspace's day counts and names its own notices alone, and another workspace can neither read nor write it; the log and a data download give a workspace its own days (SEC-001, PRV-003)",
        async () => {
          const a = await workspace(),
            b = await workspace();
          await ruleNotice(a, lagos(R, "10:00:00"), "Synthetic rule: the first workspace's");
          await ruleNotice(b, lagos(R, "10:00:00"), "Synthetic rule: the second workspace's");
          await ruleNotice(b, lagos(R, "11:00:00"), "Synthetic rule: the second workspace's other");
          // A run for one workspace records nothing for the other.
          assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: a.workspaceId }), { owed: 1 });
          assert.equal((await digestsOf(b)).length, 0);
          const own = await owedDay(a);
          const sender = standInSender({ keep: true });
          await dispatchDueMessages(sender, new Date(), { workspaceId: a.workspaceId });
          assert.equal(sender.kept.length, 1);
          assert.ok(sender.kept[0]!.text.includes("- Withdrawn: Synthetic rule: the first workspace's"));
          assert.ok(!sender.kept[0]!.text.includes("the second workspace's"));
          assert.deepEqual(sender.kept[0]!.recipient, { identityId: a.identityId });
          // Asked for from the other workspace, the day is not found: in the dispatcher's own words, by
          // the workspace named, and in that workspace's scope, by the database.
          assert.equal(await db.transaction((tx) => dayNotices(tx, b.workspaceId, own.digest.id)), null);
          const inB = <T>(run: () => Promise<T>) => runInWorkspaceScope(b.workspaceId, run);
          const refusal = (pattern: RegExp) => (error: Error) =>
            pattern.test(String((error as { cause?: Error }).cause?.message ?? error.message));
          assert.deepEqual(await inB(async () => await db.select().from(valoNoticeDigests)), []);
          assert.equal(
            await inB(() => db.transaction((tx) => dayNotices(tx, a.workspaceId, own.digest.id))),
            null,
          );
          // A customer request reads its workspace's days and writes none: the worker records them.
          const inA = <T>(run: () => Promise<T>) => runInWorkspaceScope(a.workspaceId, run);
          assert.deepEqual(
            (await inA(async () => await db.select().from(valoNoticeDigests))).map((d) => [d.id, d.day]),
            [[own.digest.id, R]],
          );
          for (const scoped of [inA, inB]) {
            await assert.rejects(
              scoped(
                async () =>
                  await db
                    .insert(valoNoticeDigests)
                    .values({ id: randomUUID(), workspaceId: a.workspaceId, day: plus(R, -2) }),
              ),
              refusal(/permission denied for table valo_notice_digests/),
            );
            await assert.rejects(
              scoped(
                async () =>
                  await db
                    .update(valoNoticeDigests)
                    .set({ day: plus(R, -2) })
                    .where(eq(valoNoticeDigests.id, own.digest.id)),
              ),
              refusal(/permission denied for table valo_notice_digests/),
            );
            await assert.rejects(
              scoped(
                async () => await db.delete(valoNoticeDigests).where(eq(valoNoticeDigests.id, own.digest.id)),
              ),
              refusal(/permission denied for table valo_notice_digests/),
            );
          }
          assert.deepEqual(
            (await digestsOf(a)).map((d) => d.day),
            [R],
          );
          // The log names the day, and no order or refund; the other workspace's log has nothing.
          const log = ListWorkspaceMessagesResponse.parse(await listWorkspaceMessages(a));
          assert.equal(log.length, 1);
          assert.deepEqual(
            {
              id: log[0]!.id,
              kind: log[0]!.kind,
              noticesDay: log[0]!.noticesDay,
              orderId: log[0]!.orderId,
              orderReference: log[0]!.orderReference,
              refundReference: log[0]!.refundReference,
              forYou: log[0]!.forYou,
              status: log[0]!.status,
              delivery: log[0]!.delivery,
            },
            {
              id: own.message.id,
              kind: "notices_digest",
              noticesDay: R,
              orderId: null,
              orderReference: null,
              refundReference: null,
              forYou: true,
              status: "recorded",
              delivery: null,
            },
          );
          assert.deepEqual(await listWorkspaceMessages(b), []);
          // A data download lists the workspace's own days, with the id its message is about.
          const days = (await workspaceDataExport(a)).data.noticeDays as Record<string, unknown>[];
          assert.equal(days.length, 1);
          assert.deepEqual(Object.keys(days[0]!).sort(), ["createdAt", "day", "id"]);
          assert.deepEqual([days[0]!.id, days[0]!.day], [own.digest.id, R]);
          assert.deepEqual((await workspaceDataExport(b)).data.noticeDays, []);
          // The second workspace's day is its own, with both its notices.
          assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: b.workspaceId }), { owed: 1 });
          const theirs = standInSender({ keep: true });
          await dispatchDueMessages(theirs, new Date(), { workspaceId: b.workspaceId });
          assert.deepEqual(
            theirs.kept[0]!.text.split("\n").filter((line) => line.startsWith("- ")),
            [
              "- Withdrawn: Synthetic rule: the second workspace's",
              "- Withdrawn: Synthetic rule: the second workspace's other",
            ],
          );
        },
      );

      await t.test(
        "a workspace whose deletion is recorded is owed nothing, and a day more than a week back owes no message",
        async () => {
          const erased = await workspace();
          await ruleNotice(erased, lagos(R, "10:00:00"), "Synthetic rule");
          // Recorded as an erasure records it, with the current signing key, so sign-in's own check of
          // erased identities reads it as any other.
          await db.transaction(async (tx) => {
            const signer = await privacySigner(tx);
            await tx.insert(valoPrivacyTombstones).values({
              id: randomUUID(),
              workspaceId: erased.workspaceId,
              caseId: randomUUID(),
              identityHash: quotaSubjectHash(signer.key, "user", `synthetic-notices-erased-${randomUUID()}`),
              phase: "erased",
              keyVersion: signer.version,
              // Never due for the erasure's own file clean-up, which has nothing of this fixture's to find.
              nextReplayAt: new Date(Date.now() + 3650 * DAY_MS),
            });
          });
          assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: erased.workspaceId }), {
            owed: 0,
          });
          assert.equal((await digestsOf(erased)).length, 0);
          assert.equal((await noticeMessagesOf(erased)).length, 0);

          // At 07:00 on the morning after R, the week back is R-6 to R. A day before that stays in the app.
          const late = await workspace();
          await ruleNotice(late, lagos(plus(R, -7), "23:59:59"), "Synthetic rule: eight days back");
          await ruleNotice(late, lagos(plus(R, -6), "00:00:00"), "Synthetic rule: a week back");
          assert.deepEqual(await oweNoticeDigests(morning(R), { workspaceId: late.workspaceId }), {
            owed: 1,
          });
          assert.deepEqual(
            (await digestsOf(late)).map((d) => d.day),
            [plus(R, -6)],
          );
        },
      );

      await t.test(
        "the worker's task records what is owed and offers it in one run, and a failure of one part does not stop another",
        async () => {
          const a = await workspace(),
            inA = { workspaceId: a.workspaceId };
          await ruleNotice(a, lagos(R, "10:00:00"), "Synthetic rule");
          const sender = standInSender({ keep: true });
          // The messages cannot be offered: the task fails, and the day is recorded all the same.
          await assert.rejects(
            runMessagesJob(sender, new Date(), inA, {
              offer: async () => {
                throw Error("SYNTHETIC_OFFER_FAILURE");
              },
              record: recordDeliveryReports,
            }),
            /MESSAGES_JOB_PARTIALLY_FAILED/,
          );
          const { message } = await owedDay(a);
          assert.equal(message.status, "queued");
          // The days cannot be recorded: the task fails, and the message waiting is offered all the same.
          await assert.rejects(
            runMessagesJob(sender, new Date(), inA, {
              owe: async () => {
                throw Error("SYNTHETIC_OWE_FAILURE");
              },
              offer: dispatchDueMessages,
              record: recordDeliveryReports,
            }),
            /MESSAGES_JOB_PARTIALLY_FAILED/,
          );
          assert.equal((await row(message.id)).status, "accepted");
          assert.equal(sender.kept.length, 1);
          // With every part working, a day's notices are recorded and their message offered in one run.
          const b = await workspace();
          await ruleNotice(b, lagos(R, "10:00:00"), "Synthetic rule");
          const ran = await runMessagesJob(sender, new Date(), { workspaceId: b.workspaceId });
          assert.deepEqual([ran.notices, ran.checked, ran.offered], [{ owed: 1 }, 1, 1]);
          assert.ok(ran.reports);
          assert.equal((await owedDay(b)).message.status, "accepted");
        },
      );

      await t.test(
        "where the days' table is not there yet, the check each of its readers makes first says so, and nothing in the transaction fails",
        async () => {
          await db.transaction(async (tx) => {
            // As a database is before the notice digests migration reaches it: no such table by the name a
            // query finds it under. This transaction alone looks where the table is not.
            await tx.execute(sql`set local search_path to pg_catalog`);
            assert.equal(await noticeDigestsReady(tx), false);
            // Nothing failed in the transaction, so a reader's own work would still commit.
            assert.deepEqual((await tx.execute(sql`select 1 as ok`)).rows, [{ ok: 1 }]);
          });
          assert.equal(await noticeDigestsReady(db), true);
        },
      );

      await t.test(
        "once every ended day is recorded the task does not read the week's notices again that day, and it reads them again the next morning",
        async () => {
          // A month back, where no other test's notices are: these runs are the worker's own, over
          // every workspace.
          const M = plus(R, -30);
          const a = await workspace(),
            b = await workspace();
          await ruleNotice(a, lagos(M, "10:00:00"), "Synthetic rule");
          assert.deepEqual(await oweNoticeDigests(morning(M)), { owed: 1 });
          assert.equal((await owedDay(a)).digest.day, M);
          // A notice dated on a day already settled, which no change in the product makes: it is not
          // looked for again that day.
          await ruleNotice(b, lagos(M, "11:00:00"), "Synthetic rule");
          assert.deepEqual(await oweNoticeDigests(lagos(plus(M, 1), "23:59:59")), { owed: 0 });
          assert.equal((await digestsOf(b)).length, 0);
          // A run kept to one workspace always looks; here it is the next morning's own run that finds it.
          assert.deepEqual(await oweNoticeDigests(morning(plus(M, 1))), { owed: 1 });
          assert.equal((await owedDay(b)).digest.day, M);
        },
      );
    } finally {
      guard.restore();
      await restorePause();
      // This test's own notices and days, so that no later run of the task finds them.
      if (made.length) {
        await db
          .delete(valoMessages)
          .where(and(inArray(valoMessages.workspaceId, made), eq(valoMessages.kind, "notices_digest")));
        for (const table of [valoNoticeDigests, valoRuleNotices, valoEditionNotices, valoCorrectionNotices])
          await db.delete(table).where(inArray(table.workspaceId, made));
      }
      await pool.end();
    }
  },
);
