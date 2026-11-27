import test from "node:test";
import assert from "node:assert/strict";
import {
  reminderEmailConfiguration,
  createResendReminderSender,
  automaticReminderDeliveryReady,
} from "./valo-reminder-resend";
import { ReminderAddressSuppressed } from "./valo-reminder-sender";
import { readUnsubscribeToken, unsubscribeToken } from "../messages/unsubscribe-token";
const env = {
  NODE_ENV: "development",
  VALO_EMAIL_MODE: "development-test",
  VALO_EMAIL_FROM: "sender@synthetic.invalid",
  VALO_EMAIL_TEST_RECIPIENT: "owner@synthetic.invalid",
  VALO_TRUSTED_ORIGIN: "https://valo.synthetic.invalid",
};
const config = reminderEmailConfiguration(env)!;
const input = {
  idempotencyKey: "synthetic-task/2026-11-20/1",
  workspaceId: "00000000-0000-4000-8000-0000000000a1",
  reminderId: "00000000-0000-4000-8000-0000000000b2",
  ownerIdentityId: "synthetic-owner",
  title: "PRIVATE TASK TITLE",
  dueDate: "2026-11-20",
  timezone: "Africa/Lagos" as const,
  signal: new AbortController().signal,
};
const id = "6ddc3cb1-a114-4a93-9c72-39f5720856bb";
/** No address is suppressed, unless a test says one is. */
const notSuppressed = async () => false;
/** A keyring of this test's own, and the real token of a reminder's unsubscribe link under it. */
const ring = {
  current: "synthetic-key-1",
  keys: { "synthetic-key-1": "synthetic-mailer-key-".padEnd(40, "1") },
};
const tokenFor = (about: { workspaceId: string; reminderId: string; identityId: string }) =>
  unsubscribeToken(
    {
      consent: "reminders",
      workspaceId: about.workspaceId,
      recordId: about.reminderId,
      identityId: about.identityId,
    },
    ring,
  );
test("real sending is disabled without complete development-only settings", () => {
  assert.equal(reminderEmailConfiguration({}), null);
  assert.equal(reminderEmailConfiguration({ ...env, NODE_ENV: "production" }), null);
  assert.equal(reminderEmailConfiguration({ ...env, REPLIT_DEPLOYMENT: "1" }), null);
  assert.equal(reminderEmailConfiguration({ ...env, VALO_EMAIL_MODE: undefined }), null);
  assert.equal(
    reminderEmailConfiguration({ ...env, VALO_EMAIL_FROM: "a@b.invalid\r\nBcc:elsewhere@example.invalid" }),
    null,
  );
  assert.equal(reminderEmailConfiguration({ ...env, VALO_TRUSTED_ORIGIN: "http://synthetic.invalid" }), null);
  assert.equal(automaticReminderDeliveryReady(env), false, "Addresses must not release an existing backlog");
  assert.equal(
    automaticReminderDeliveryReady({ ...env, VALO_EMAIL_OUTBOX_ENABLED: "development-test" }),
    true,
  );
  assert.equal(
    automaticReminderDeliveryReady({
      ...env,
      NODE_ENV: "production",
      VALO_EMAIL_OUTBOX_ENABLED: "development-test",
    }),
    false,
  );
});
test("only the selected verified workspace owner's allowlisted email can reach transport", async () => {
  let calls = 0;
  for (const recipient of [null, "other@synthetic.invalid"]) {
    const sender = createResendReminderSender(
      config,
      async () => {
        calls++;
        return Response.json({ id });
      },
      async () => recipient,
      notSuppressed,
      tokenFor,
      env,
    );
    await assert.rejects(() => sender.send(input), /RECIPIENT_NOT_AUTHORIZED/);
  }
  assert.equal(calls, 0);
});
test("controlled acceptance preserves one bounded provider key and minimal stable body, not inbox delivery", async () => {
  const requests: { body: string; headers: Record<string, string> }[] = [];
  const sender = createResendReminderSender(
    config,
    async (path, options) => {
      assert.equal(path, "/emails");
      assert.equal(options.method, "POST");
      assert.equal(options.signal, input.signal);
      requests.push(options);
      return Response.json({ id });
    },
    async () => config.recipient,
    notSuppressed,
    tokenFor,
    env,
  );
  assert.deepEqual(await sender.send(input), { providerMessageId: id });
  await sender.send({ ...input, title: "RENAMED PRIVATE TITLE" });
  assert.equal(requests[0]!.body, requests[1]!.body);
  assert.equal(requests[0]!.headers["Idempotency-Key"], requests[1]!.headers["Idempotency-Key"]);
  assert.ok(requests[0]!.headers["Idempotency-Key"]!.length <= 256);
  assert.equal(requests[0]!.headers.Authorization, undefined);
  const body = JSON.parse(requests[0]!.body);
  assert.deepEqual(body.to, [config.recipient]);
  assert.ok(!requests[0]!.body.includes("PRIVATE") && !requests[0]!.body.includes(input.ownerIdentityId));
  assert.ok(!("attachments" in body) && !("bcc" in body) && !("deliveredAt" in body));
  assert.equal(sender.replayWindowMs, 23 * 60 * 60 * 1000);
});
test("controlled provider rate failure, oversized data and invalid acknowledgement never become accepted", async () => {
  for (const response of [
    new Response("untrusted response", { status: 429 }),
    new Response("x".repeat(8193)),
    Response.json({ id: "not-a-provider-id" }),
  ]) {
    const sender = createResendReminderSender(
      config,
      async () => response,
      async () => config.recipient,
      notSuppressed,
      tokenFor,
      env,
    );
    await assert.rejects(() => sender.send(input));
  }
});
test("every nonempty deployment marker and production reject before transport, including after sender construction", async () => {
  let calls = 0;
  const runtime: NodeJS.ProcessEnv = { ...env };
  const sender = createResendReminderSender(
    config,
    async () => {
      calls++;
      return Response.json({ id });
    },
    async () => config.recipient,
    notSuppressed,
    tokenFor,
    runtime,
  );
  for (const marker of ["1", "0", "false", "true", "production", " ", "\t"]) {
    runtime.REPLIT_DEPLOYMENT = marker;
    assert.equal(reminderEmailConfiguration(runtime), null);
    assert.equal(
      automaticReminderDeliveryReady({ ...runtime, VALO_EMAIL_OUTBOX_ENABLED: "development-test" }),
      false,
    );
    await assert.rejects(() => sender.send(input), /EMAIL_DEVELOPMENT_ONLY/);
  }
  delete runtime.REPLIT_DEPLOYMENT;
  runtime.NODE_ENV = "production";
  await assert.rejects(() => sender.send(input), /EMAIL_DEVELOPMENT_ONLY/);
  assert.equal(calls, 0);
  runtime.NODE_ENV = "development";
  runtime.VALO_ISOLATED_RECOVERY = "synthetic-local-only";
  await assert.rejects(() => sender.send(input), /RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
  assert.equal(calls, 0);
});
test("a reminder to an address Valo has stopped sending to never reaches transport, and neither does one whose suppression cannot be checked", async () => {
  let calls = 0;
  const asked: string[] = [];
  const transport = async () => {
    calls++;
    return Response.json({ id });
  };
  const suppressed = createResendReminderSender(
    config,
    transport,
    async () => config.recipient,
    async (address) => {
      asked.push(address);
      return true;
    },
    tokenFor,
    env,
  );
  await assert.rejects(
    () => suppressed.send(input),
    (error: unknown) =>
      error instanceof ReminderAddressSuppressed && error.message === "EMAIL_ADDRESS_SUPPRESSED",
  );
  // The question is asked of the verified recipient's own address, and of no other.
  assert.deepEqual(asked, [config.recipient]);
  // A check that fails is not an answer of "no": nothing is sent, and the error is not a suppression.
  const unknown = createResendReminderSender(
    config,
    transport,
    async () => config.recipient,
    async () => {
      throw Error("EMAIL_SUPPRESSION_CHECK_UNAVAILABLE");
    },
    tokenFor,
    env,
  );
  await assert.rejects(
    () => unknown.send(input),
    (error: unknown) =>
      !(error instanceof ReminderAddressSuppressed) && /CHECK_UNAVAILABLE/.test(String(error)),
  );
  // A recipient who is not the allowed one is refused before the question is asked at all.
  const other = createResendReminderSender(
    config,
    transport,
    async () => "other@synthetic.invalid",
    async (address) => {
      asked.push(address);
      return false;
    },
    tokenFor,
    env,
  );
  await assert.rejects(() => other.send(input), /RECIPIENT_NOT_AUTHORIZED/);
  assert.deepEqual(asked, [config.recipient]);
  assert.equal(calls, 0);
});
test("a reminder carries its unsubscribe link in its words and in the headers a mail program reads, the same on every attempt, and never goes without one", async () => {
  const requests: { body: string }[] = [];
  const asked: unknown[] = [];
  const transport = async (_path: string, options: { body: string }) => {
    requests.push(options);
    return Response.json({ id });
  };
  const sender = createResendReminderSender(
    config,
    transport,
    async () => config.recipient,
    notSuppressed,
    (about) => {
      asked.push(about);
      return tokenFor(about);
    },
    env,
  );
  await sender.send(input);
  await sender.send(input);
  // The link is asked for this reminder, its workspace and the person it goes to.
  assert.deepEqual(asked[0], {
    workspaceId: input.workspaceId,
    reminderId: input.reminderId,
    identityId: input.ownerIdentityId,
  });
  // A retried send is the same send: a provider that compares the two finds no difference.
  assert.equal(requests[0]!.body, requests[1]!.body);
  const body = JSON.parse(requests[0]!.body);
  const token = tokenFor({
    workspaceId: input.workspaceId,
    reminderId: input.reminderId,
    identityId: input.ownerIdentityId,
  });
  // For a person: the page, in the words. Opening it changes nothing; the page asks first.
  assert.ok(
    body.text.includes(
      `stop them without signing in: https://valo.synthetic.invalid/unsubscribe?t=${token}\n`,
    ),
  );
  // For a mail program's own unsubscribe button: the address it posts to, and that one press is enough.
  assert.deepEqual(body.headers, {
    "List-Unsubscribe": `<https://valo.synthetic.invalid/api/public/unsubscribe/one-click?t=${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  // The link is the real one: it reads as this reminder's, made for its owner and no one else.
  const link = readUnsubscribeToken(token, ring)!;
  assert.deepEqual(
    [
      link.consent,
      link.workspaceId,
      link.recordId,
      link.madeFor(input.ownerIdentityId),
      link.madeFor("synthetic-other"),
    ],
    ["reminders", input.workspaceId, input.reminderId, true, false],
  );
  // It names no one: neither the words nor the headers hold the owner's identifier.
  assert.ok(!requests[0]!.body.includes(input.ownerIdentityId));

  // A reminder is an optional message, and is not sent without its link.
  const before = requests.length;
  for (const broken of [
    () => {
      throw Error("SYNTHETIC_KEYRING_UNAVAILABLE");
    },
    () => "",
    () => "has a space",
    () => "a/b",
    () => "x".repeat(201),
  ]) {
    const without = createResendReminderSender(
      config,
      transport,
      async () => config.recipient,
      notSuppressed,
      broken,
      env,
    );
    await assert.rejects(
      () => without.send(input),
      /SYNTHETIC_KEYRING_UNAVAILABLE|EMAIL_UNSUBSCRIBE_LINK_UNAVAILABLE/,
    );
  }
  assert.equal(requests.length, before);
  // An address Valo has stopped sending to is refused before a link is made at all.
  let made = 0;
  const stopped = createResendReminderSender(
    config,
    transport,
    async () => config.recipient,
    async () => true,
    (about) => {
      made++;
      return tokenFor(about);
    },
    env,
  );
  await assert.rejects(
    () => stopped.send(input),
    (error: unknown) => error instanceof ReminderAddressSuppressed,
  );
  assert.equal(made, 0);
});
