import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  pool,
  valoConsentChanges,
  valoEvents,
  valoMemberships,
  valoPrivacyTombstones,
  valoRateBuckets,
  valoReminderOutbox,
  valoReminderPreferences,
  valoTasks,
} from "@workspace/db";
import { UnsubscribeResponse } from "@workspace/api-zod";
import { privacyNotice } from "@workspace/valo-core/privacy-notice";
import app from "../app";
import { privacySigner } from "../lib/valo-privacy-keys";
import { quotaSubjectHash } from "../lib/valo-quota-policy";
import { resolveWorkspace, type WorkspaceActor } from "../modules/workspaces";
import { unsubscribeToken } from "../modules/messages/unsubscribe-token";
import {
  createResendReminderSender,
  reminderEmailConfiguration,
} from "../modules/tasks/valo-reminder-resend";
import { processReminder } from "../modules/tasks/valo-reminder-worker";
import { createTask, reminderInstant, saveReminderPreferences } from "../modules/tasks/valo-tasks";

/**
 * The unsubscribe link over real HTTP (docs/architecture/messages.md, part 4): the real application and
 * database, synthetic workspaces and reminders, and links this test makes under the run's own key. The
 * mailer's transport is the test's own. No email service is called and no message reaches anyone.
 */
test(
  "an unsubscribe link turns its workspace's reminders off without sign-in, records the choice, and does nothing else (WRK-004, PRO-002)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.equal(Boolean(process.env.REPLIT_DEPLOYMENT), false);
    for (const name of [
      "VALO_TRUSTED_ORIGIN",
      "VALO_PRIVACY_KEYRING",
      "CLERK_SECRET_KEY",
      "CLERK_PUBLISHABLE_KEY",
    ])
      assert.equal(Boolean(process.env[name]), false, `must not replace a configured ${name}`);
    const priorTelemetry = process.env.CLERK_TELEMETRY_DISABLED;
    // The real identity middleware's signed-out path needs syntactically valid configuration, but no
    // session or provider request. These values cannot authenticate anyone.
    process.env.CLERK_SECRET_KEY = "sk_test_" + "synthetic_configuration_not_a_real_key";
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_test_" + Buffer.from("synthetic.clerk.accounts.dev$").toString("base64");
    process.env.CLERK_TELEMETRY_DISABLED = "true";
    const site = "https://valo.synthetic.invalid";
    process.env.VALO_TRUSTED_ORIGIN = site;
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const originalFetch = globalThis.fetch;
    let externalRequests = 0;
    globalThis.fetch = ((input, init) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (target.origin !== base) {
        externalRequests++;
        throw Error("EXTERNAL_REQUEST_FORBIDDEN_IN_SYNTHETIC_HTTP_TEST");
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      now = new Date(+reminderInstant(due, 1) + 1);
    /** A workspace with reminders on and one reminder due, and the link that reminder would carry. */
    async function withReminder() {
      const actor = await resolveWorkspace(`synthetic-unsubscribe-${randomUUID()}`);
      await saveReminderPreferences(actor, { enabled: true, offsets: [1], expectedRevision: 0 });
      const task = await createTask(actor, {
        title: "Controlled reminder for the unsubscribe test",
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
      const token = unsubscribeToken({
        consent: "reminders",
        workspaceId: actor.workspaceId,
        recordId: reminder!.id,
        identityId: actor.identityId,
      });
      return { actor, task, reminder: reminder!, token };
    }
    const preferences = async (actor: WorkspaceActor) =>
      (
        await db
          .select()
          .from(valoReminderPreferences)
          .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId))
      )[0]!;
    const choices = (actor: WorkspaceActor) =>
      db
        .select()
        .from(valoConsentChanges)
        .where(eq(valoConsentChanges.workspaceId, actor.workspaceId))
        .orderBy(asc(valoConsentChanges.createdAt));
    const reminders = (actor: WorkspaceActor) =>
      db.select().from(valoReminderOutbox).where(eq(valoReminderOutbox.workspaceId, actor.workspaceId));
    /** As the page asks: JSON, from Valo's own site. */
    const fromPage = (token: unknown, headers: Record<string, string> = {}) =>
      fetch(base + "/api/public/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: site, ...headers },
        body: JSON.stringify({ token }),
      });
    /** As a mail service asks: a form, from nowhere a browser would say, with no session. */
    const oneClick = (token: string, body = "List-Unsubscribe=One-Click") =>
      fetch(base + "/api/public/unsubscribe/one-click?t=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    const refusal = z.object({ error: z.string() }).passthrough();
    const REFUSED =
      "This link does not work. It may be incomplete, or older than Valo still accepts. Nothing was changed.";
    try {
      await t.test(
        "opening the link's address changes nothing, and sends the person to the page",
        async () => {
          const { actor, token } = await withReminder();
          const opened = await fetch(base + "/api/public/unsubscribe/one-click?t=" + token, {
            redirect: "manual",
          });
          assert.equal(opened.status, 303);
          assert.equal(opened.headers.get("Location"), `${site}/unsubscribe?t=${token}`);
          assert.match(opened.headers.get("Cache-Control")!, /no-store/);
          // Only a token's own characters are passed on to the page's address.
          for (const strange of [
            "a b",
            "a/b",
            "https://elsewhere.invalid",
            "<script>",
            "x".repeat(182),
            "",
          ]) {
            const answered = await fetch(
              base + "/api/public/unsubscribe/one-click?t=" + encodeURIComponent(strange),
              { redirect: "manual" },
            );
            assert.equal(answered.status, 303, strange);
            assert.equal(answered.headers.get("Location"), `${site}/unsubscribe`, strange);
          }
          // The page's own address answers no read at all.
          const read = await fetch(base + "/api/public/unsubscribe?token=" + token);
          assert.ok(read.status >= 400, String(read.status));
          assert.equal((await preferences(actor)).enabled, true);
          assert.deepEqual(
            (await choices(actor)).map((row) => row.choice),
            [true],
          );
        },
      );

      await t.test(
        "the page's request turns reminders off, records the choice with the notice in force, cancels what was waiting, and a due reminder is then not sent",
        async () => {
          const { actor, task, reminder, token } = await withReminder();
          // Another workspace, with reminders on and one waiting, which this link is not about.
          const other = await withReminder();
          // One reminder of the workspace was cancelled before, for its own reason, and one was sent.
          const earlier = randomUUID(),
            sent = randomUUID();
          await db.insert(valoReminderOutbox).values([
            {
              id: earlier,
              workspaceId: actor.workspaceId,
              taskId: task.id,
              idempotencyKey: `synthetic-earlier-${earlier}`,
              scheduledAt: new Date(+now - 86400000),
              status: "cancelled",
              reason: "TASK_CHANGED",
            },
            {
              id: sent,
              workspaceId: actor.workspaceId,
              taskId: task.id,
              idempotencyKey: `synthetic-sent-${sent}`,
              scheduledAt: new Date(+now - 2 * 86400000),
              status: "sent",
              providerMessageId: randomUUID(),
            },
          ]);
          const before = await preferences(actor);
          const answer = await fromPage(token);
          assert.equal(answer.status, 200);
          assert.match(answer.headers.get("Cache-Control")!, /no-store/);
          assert.deepEqual(UnsubscribeResponse.parse(await answer.json()), {
            consent: "reminders",
            state: "off",
          });
          const after = await preferences(actor);
          assert.deepEqual(
            [after.enabled, after.revision, after.offsets, after.actorId],
            [false, before.revision + 1, before.offsets, actor.identityId],
          );
          // The choice is in the workspace's consent history, as one made in the app is: who, what, and
          // the notice in force.
          const history = await choices(actor);
          assert.deepEqual(
            history.map((row) => [row.consent, row.choice, row.actorId, row.noticeVersion]),
            [
              ["reminders", true, actor.identityId, privacyNotice().version],
              ["reminders", false, actor.identityId, privacyNotice().version],
            ],
          );
          // What was waiting is cancelled and says why. What was cancelled before keeps its own reason,
          // and what was sent stays sent.
          const rows = new Map((await reminders(actor)).map((row) => [row.id, row]));
          assert.deepEqual(
            [reminder.id, earlier, sent].map((id) => [rows.get(id)!.status, rows.get(id)!.reason]),
            [
              ["cancelled", "REMINDERS_OPTED_OUT"],
              ["cancelled", "TASK_CHANGED"],
              ["sent", null],
            ],
          );
          // The workspace's history names the reminder that carried the link.
          const [event] = await db
            .select()
            .from(valoEvents)
            .where(
              and(
                eq(valoEvents.workspaceId, actor.workspaceId),
                eq(valoEvents.action, "reminders.stopped_by_link"),
              ),
            );
          assert.deepEqual(
            [event?.entityId, event?.actorId, event?.revision],
            [reminder.id, actor.identityId, after.revision],
          );
          // Enforced before dispatch, not only when the reminders were cancelled. The reminder that was
          // due is put back as waiting, as one planned at that same moment would be. The worker reads the
          // choice again before it sends, cancels it and hands it to no sender.
          await db
            .update(valoReminderOutbox)
            .set({ status: "pending", reason: null })
            .where(eq(valoReminderOutbox.id, reminder.id));
          let handed = 0;
          const outcome = await processReminder(
            actor.workspaceId,
            reminder.id,
            {
              send: async () => {
                handed++;
                return { providerMessageId: randomUUID() };
              },
            },
            now,
          );
          assert.equal(outcome, "cancelled");
          assert.equal(handed, 0);
          const [stopped] = await db
            .select()
            .from(valoReminderOutbox)
            .where(eq(valoReminderOutbox.id, reminder.id));
          assert.deepEqual([stopped?.status, stopped?.reason], ["cancelled", "REMINDERS_OPTED_OUT"]);

          // The same link again: the same answer, and nothing more is changed or recorded.
          const again = await fromPage(token);
          assert.equal(again.status, 200);
          assert.deepEqual(UnsubscribeResponse.parse(await again.json()), {
            consent: "reminders",
            state: "off",
          });
          assert.equal((await preferences(actor)).revision, after.revision);
          assert.equal((await choices(actor)).length, 2);
          // The link stops reminders and nothing else: the task is as it was.
          const [kept] = await db.select().from(valoTasks).where(eq(valoTasks.id, task.id));
          assert.deepEqual(
            [kept?.title, kept?.dueDate, kept?.dateConfirmed, kept?.deletedAt, kept?.revision],
            [task.title, due, true, null, task.revision],
          );
          // And it stops them for its own workspace alone: the other's reminders are on, its reminder is
          // still waiting, and its history has only the choice its owner made.
          assert.equal((await preferences(other.actor)).enabled, true);
          assert.deepEqual(
            (await reminders(other.actor)).map((row) => [row.id, row.status]),
            [[other.reminder.id, other.reminder.status]],
          );
          assert.deepEqual(
            (await choices(other.actor)).map((row) => row.choice),
            [true],
          );
        },
      );

      await t.test(
        "the link in the reminder the mailer would send is one a mail service's one-click request can use, with no origin and whatever body",
        async () => {
          const { actor, reminder } = await withReminder();
          // The reminder goes through the worker and the real mailer, whose transport is this test's own.
          const address = `synthetic-unsubscribe-${randomUUID()}@example.test`;
          const env = {
            NODE_ENV: "development",
            VALO_EMAIL_MODE: "development-test",
            VALO_EMAIL_FROM: "synthetic-sender@example.test",
            VALO_EMAIL_TEST_RECIPIENT: address,
            VALO_TRUSTED_ORIGIN: site,
          };
          const sentBodies: string[] = [];
          const mailer = createResendReminderSender(
            reminderEmailConfiguration(env)!,
            async (_path, options) => {
              sentBodies.push(options.body);
              return Response.json({ id: randomUUID() });
            },
            async () => address,
            async () => false,
            (about) =>
              unsubscribeToken({
                consent: "reminders",
                workspaceId: about.workspaceId,
                recordId: about.reminderId,
                identityId: about.identityId,
              }),
            env,
          );
          assert.equal(await processReminder(actor.workspaceId, reminder.id, mailer, now), "sent");
          const mail = z
            .object({ text: z.string(), headers: z.record(z.string(), z.string()) })
            .parse(JSON.parse(sentBodies[0]!));
          assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
          const posted =
            /^<https:\/\/valo\.synthetic\.invalid\/api\/public\/unsubscribe\/one-click\?t=([A-Za-z0-9._-]+)>$/.exec(
              mail.headers["List-Unsubscribe"]!,
            );
          assert.ok(posted, mail.headers["List-Unsubscribe"]);
          const token = posted[1]!;
          // The same link is in the words, for a person, as the page's address.
          assert.ok(mail.text.includes(`${site}/unsubscribe?t=${token}\n`));
          // The mail names no one: not the owner's identifier, and not the task.
          assert.doesNotMatch(sentBodies[0]!, /synthetic-unsubscribe-[0-9a-f-]{36}"|Controlled reminder/);
          assert.ok(!sentBodies[0]!.includes(actor.identityId));

          assert.equal((await preferences(actor)).enabled, true);
          const answer = await oneClick(token);
          assert.equal(answer.status, 200);
          assert.deepEqual(UnsubscribeResponse.parse(await answer.json()), {
            consent: "reminders",
            state: "off",
          });
          assert.equal((await preferences(actor)).enabled, false);
          assert.deepEqual(
            (await choices(actor)).map((row) => [row.choice, row.actorId]),
            [
              [true, actor.identityId],
              [false, actor.identityId],
            ],
          );
          // The owner turns reminders on again in the app. The old link still stops them: it does not
          // expire, and a press on a mail program's button sends whatever body that program chooses.
          const on = await preferences(actor);
          await saveReminderPreferences(actor, {
            enabled: true,
            offsets: [1],
            expectedRevision: on.revision,
          });
          for (const body of ["", "anything=else", "x".repeat(4000)]) {
            assert.equal((await oneClick(token, body)).status, 200, body.slice(0, 20));
            assert.equal((await preferences(actor)).enabled, false);
          }
          assert.deepEqual(
            (await choices(actor)).map((row) => row.choice),
            [true, false, true, false],
          );
        },
      );

      await t.test(
        "a link that is not Valo's, was changed, was made for someone else, or is for a workspace that is not there, whose owner's access is off or whose deletion is recorded, is refused alike and changes nothing",
        async () => {
          const { actor, reminder, token } = await withReminder();
          const [version, payload, signature] = token.split(".") as [string, string, string];
          const flipped = (text: string) => (text[0] === "A" ? "B" : "A") + text.slice(1);
          const refused = [
            "not-a-link",
            [version, flipped(payload), signature].join("."),
            [version, payload, flipped(signature)].join("."),
            ["synthetic-no-such-key", payload, signature].join("."),
            // Made for someone who is not the workspace's owner: another member, or an earlier owner.
            unsubscribeToken({
              consent: "reminders",
              workspaceId: actor.workspaceId,
              recordId: reminder.id,
              identityId: `synthetic-unsubscribe-${randomUUID()}`,
            }),
            // Made for this person, about a workspace that is not there.
            unsubscribeToken({
              consent: "reminders",
              workspaceId: randomUUID(),
              recordId: reminder.id,
              identityId: actor.identityId,
            }),
          ];
          for (const each of refused) {
            for (const answer of [await fromPage(each), await oneClick(each)]) {
              assert.equal(answer.status, 400, each);
              assert.equal(refusal.parse(await answer.json()).error, REFUSED, each);
            }
          }
          // A request that is not in the page's own form is refused before a link is read.
          for (const body of [{}, { token: 7 }, { token, also: "this" }, { token: "x".repeat(182) }]) {
            const answer = await fetch(base + "/api/public/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: site },
              body: JSON.stringify(body),
            });
            assert.ok(
              [400, 422].includes(answer.status),
              `${JSON.stringify(body).slice(0, 40)}: ${answer.status}`,
            );
          }
          // The page's address takes a change only as Valo's own pages send one. Another site's page, a
          // request with no origin and a form are refused, even with the real link.
          for (const headers of [
            { Origin: "https://elsewhere.synthetic.invalid" },
            { Origin: site, "Sec-Fetch-Site": "cross-site" },
            { Origin: "" },
            { Origin: site, "Content-Type": "text/plain" },
          ] as Record<string, string>[]) {
            const answer = await fromPage(token, headers);
            assert.equal(answer.status, 403, JSON.stringify(headers));
          }
          // The owner's access is off. The app would take no change of theirs and the worker sends them
          // no reminder; the real link is answered as any that does not work, and changes nothing.
          const access = (active: "yes" | "no") =>
            db
              .update(valoMemberships)
              .set({ active })
              .where(eq(valoMemberships.workspaceId, actor.workspaceId));
          await access("no");
          for (const answer of [await fromPage(token), await oneClick(token)]) {
            assert.equal(answer.status, 400);
            assert.equal(refusal.parse(await answer.json()).error, REFUSED);
          }
          await access("yes");
          // A workspace whose deletion is recorded. The marker is synthetic and stands for no erasure. It
          // is recorded as an erasure records one, with the current signing key, so that sign-in's own
          // check of erased identities reads it as any other.
          const going = await withReminder();
          await db.transaction(async (tx) => {
            const signer = await privacySigner(tx);
            await tx.insert(valoPrivacyTombstones).values({
              id: randomUUID(),
              workspaceId: going.actor.workspaceId,
              caseId: randomUUID(),
              identityHash: quotaSubjectHash(
                signer.key,
                "user",
                `synthetic-unsubscribe-erased-${randomUUID()}`,
              ),
              phase: "erased",
              keyVersion: signer.version,
              // Never due for the erasure's own file clean-up, which has nothing of this fixture's to find.
              nextReplayAt: new Date(Date.now() + 3650 * 86400000),
            });
          });
          for (const answer of [await fromPage(going.token), await oneClick(going.token)]) {
            assert.equal(answer.status, 400);
            assert.equal(refusal.parse(await answer.json()).error, REFUSED);
          }
          assert.equal((await preferences(going.actor)).enabled, true);
          assert.equal((await choices(going.actor)).length, 1);
          assert.equal((await preferences(actor)).enabled, true);
          assert.equal((await choices(actor)).length, 1);
          assert.deepEqual(
            (await reminders(actor)).map((row) => row.status),
            ["held"],
          );
          // And the real link still works afterwards: nothing above used it up.
          assert.equal((await fromPage(token)).status, 200);
          assert.equal((await preferences(actor)).enabled, false);
        },
      );

      // SEC-005: "legitimate errors explain recovery".
      await t.test(
        "one workspace's links are taken ten times a minute and no more, and the refusal says when to try again; another workspace's link is not held up, and what is not a link is counted against no workspace",
        async () => {
          const { actor, reminder, token } = await withReminder();
          const other = await withReminder();
          // The counters of this limit in the minute now running, which none can leave before it ends.
          const counters = async () =>
            Number(
              (
                await db.execute<{ counters: number }>(sql`select count(*)::int as counters
                  from valo_rate_buckets where bucket = 'unsubscribe-link' and window_started_at =
                    date_trunc('minute', statement_timestamp() at time zone 'UTC') at time zone 'UTC'`)
              ).rows[0]?.counters,
            );
          const counterOf = (workspaceId: string) =>
            db
              .select()
              .from(valoRateBuckets)
              .where(
                and(
                  eq(valoRateBuckets.bucket, "unsubscribe-link"),
                  eq(
                    valoRateBuckets.subjectHash,
                    quotaSubjectHash(process.env.SESSION_SECRET, "workspace", workspaceId),
                  ),
                ),
              );
          // The limit counts in windows of one database-clock minute. Start well inside one, so that
          // every use below falls in the same window.
          const [clock] = (
            await db.execute(sql`select extract(second from statement_timestamp())::float8 as second`)
          ).rows;
          const second = Number(clock?.second);
          if (second > 45) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000));
          // What is not a link Valo signed is refused before any workspace's count is touched.
          const before = await counters();
          for (const junk of ["not-a-link", token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA")]) {
            assert.equal((await fromPage(junk)).status, 400);
            assert.equal((await oneClick(junk)).status, 400);
          }
          assert.equal(await counters(), before);
          // Ten uses, by either way in, and by a link made for someone else: each counts for the
          // workspace its link names.
          const forAnother = unsubscribeToken({
            consent: "reminders",
            workspaceId: actor.workspaceId,
            recordId: reminder.id,
            identityId: `synthetic-unsubscribe-${randomUUID()}`,
          });
          const taken: number[] = [];
          for (let use = 0; use < 9; use++)
            taken.push((await (use % 2 ? oneClick(token) : fromPage(token))).status);
          taken.push((await oneClick(forAnother)).status);
          assert.deepEqual(taken, [...Array<number>(9).fill(200), 400]);
          assert.equal(await counters(), before + 1);
          // The count is kept under a keyed checksum of the workspace, never its identifier.
          const [counter] = await counterOf(actor.workspaceId);
          assert.equal(counter?.usedCount, 10);
          assert.ok(!JSON.stringify(counter).includes(actor.workspaceId));
          assert.deepEqual(await counterOf(other.actor.workspaceId), []);
          // The eleventh and twelfth are refused, whichever way they come and whoever the link was made
          // for, and are told how long to wait.
          for (const answer of [await fromPage(token), await oneClick(token), await oneClick(forAnother)]) {
            assert.equal(answer.status, 429);
            const wait = Number(answer.headers.get("Retry-After"));
            assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 60, String(wait));
            assert.equal(
              refusal.parse(await answer.json()).error,
              `Too many tries with this link in a short time. Try again in ${wait} seconds. This try changed nothing.`,
            );
          }
          // A refused try is not counted, and the first use, which turned the reminders off, stands.
          assert.equal((await counterOf(actor.workspaceId))[0]?.usedCount, 10);
          assert.equal((await preferences(actor)).enabled, false);
          assert.equal((await choices(actor)).length, 2);
          // Another workspace's link is not held up by this one's.
          assert.equal((await preferences(other.actor)).enabled, true);
          assert.equal((await oneClick(other.token)).status, 200);
          assert.equal((await preferences(other.actor)).enabled, false);
          assert.equal(externalRequests, 0, "no request left this machine");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.VALO_TRUSTED_ORIGIN;
      delete process.env.CLERK_SECRET_KEY;
      delete process.env.CLERK_PUBLISHABLE_KEY;
      if (priorTelemetry === undefined) delete process.env.CLERK_TELEMETRY_DISABLED;
      else process.env.CLERK_TELEMETRY_DISABLED = priorTelemetry;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
