import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { db, pool, valoEmailEvents, valoSecuritySignals } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import app from "../app";

/**
 * The email provider's delivery reports over real HTTP (docs/architecture/messages.md, slice 2a): the real
 * application and database, a signing key this test makes, and events it signs itself. No provider sends
 * anything here, and no request leaves this machine.
 */
test(
  "the email webhook keeps a signed report once, with no address, and takes nothing unsigned, stale or unset (WRK-003, SEC-008)",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.equal(Boolean(process.env.REPLIT_DEPLOYMENT), false);
    for (const name of ["VALO_EMAIL_WEBHOOK_SECRET", "CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"])
      assert.equal(Boolean(process.env[name]), false, `must not replace a configured ${name}`);
    const priorTelemetry = process.env.CLERK_TELEMETRY_DISABLED;
    // The real identity middleware's signed-out path needs syntactically valid configuration, but no
    // session or provider request. These values cannot authenticate anyone.
    process.env.CLERK_SECRET_KEY = "sk_test_" + "synthetic_configuration_not_a_real_key";
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_test_" + Buffer.from("synthetic.clerk.accounts.dev$").toString("base64");
    process.env.CLERK_TELEMETRY_DISABLED = "true";
    const key = Buffer.from("synthetic-http-email-webhook-key"),
      secret = "whsec_" + key.toString("base64");
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

    const reference = randomUUID();
    const address = `synthetic-recipient-${randomUUID()}@example.test`;
    const event = (type: string, data: Record<string, unknown> = {}) =>
      JSON.stringify({
        type,
        created_at: new Date(Date.now() - 30_000).toISOString(),
        data: {
          email_id: reference,
          from: "Valo <synthetic-sender@example.test>",
          to: [address],
          subject: "SYNTHETIC SUBJECT NEVER KEPT",
          bounce: { type: "Permanent", message: "SYNTHETIC BOUNCE TEXT NEVER KEPT" },
          ...data,
        },
      });
    const ids: string[] = [];
    const newId = () => {
      const id = `msg_synthetic_http_${randomUUID()}`;
      ids.push(id);
      return id;
    };
    /** The three headers the scheme signs with, for a body signed at `at` under `id`. */
    function signature(text: string | Buffer, id: string, at = Date.now(), signingKey = key) {
      const stamp = String(Math.floor(at / 1000));
      const signed = createHmac("sha256", signingKey).update(`${id}.${stamp}.`).update(text).digest("base64");
      return { "svix-id": id, "svix-timestamp": stamp, "svix-signature": "v1," + signed };
    }
    const post = (text: string | Buffer, headers: Record<string, string> = {}) =>
      fetch(base + "/api/webhooks/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: text,
      });
    const kept = () => db.select().from(valoEmailEvents).where(inArray(valoEmailEvents.eventKey, ids));
    const signatureFailures = async () =>
      Number(
        (
          await db
            .select({ total: sql<string>`coalesce(sum(${valoSecuritySignals.count}), 0)` })
            .from(valoSecuritySignals)
            .where(eq(valoSecuritySignals.kind, "signature_failure"))
        )[0]!.total,
      );
    const ack = z.object({ received: z.literal(true), kept: z.boolean(), duplicate: z.boolean().optional() });
    try {
      await t.test("with no signing secret set, or one that is not a secret, nothing is taken", async () => {
        const body = event("email.delivered");
        const id = newId();
        for (const value of [undefined, "", "whsec_short", "not-a-secret"]) {
          if (value === undefined) delete process.env.VALO_EMAIL_WEBHOOK_SECRET;
          else process.env.VALO_EMAIL_WEBHOOK_SECRET = value;
          const answer = await post(body, signature(body, id));
          assert.equal(answer.status, 503, String(value));
          assert.match(answer.headers.get("Cache-Control")!, /no-store/);
        }
        assert.deepEqual(await kept(), []);
      });

      process.env.VALO_EMAIL_WEBHOOK_SECRET = secret;

      await t.test(
        "a missing, altered, stale or wrongly keyed signature is refused before anything is kept, and counted",
        async () => {
          const body = event("email.delivered");
          const id = newId();
          const before = await signatureFailures();
          const good = signature(body, id);
          const refused: [string | Buffer, Record<string, string>][] = [
            [body, {}],
            [body + " ", good],
            [body, { ...good, "svix-id": newId() }],
            [body, { ...good, "svix-signature": "v1," + Buffer.alloc(32).toString("base64") }],
            // Signed a minute outside the five there are, either way. The edge of the five minutes is the
            // unit test's, which has a clock of its own: here a request signed a second beyond it, and a
            // second late in arriving, would be inside them.
            [body, signature(body, id, Date.now() - 360_000)],
            [body, signature(body, id, Date.now() + 360_000)],
            [body, signature(body, id, Date.now(), Buffer.from("synthetic-http-another-key-00000"))],
            // Signed, and sent as something other than JSON: the body is not read at all.
            [body, { ...good, "Content-Type": "text/plain" }],
          ];
          for (const [text, headers] of refused) {
            const answer = await post(text, headers);
            assert.equal(answer.status, 401, JSON.stringify(headers));
            assert.equal(
              z
                .object({ error: z.string() })
                .passthrough()
                .parse(await answer.json()).error,
              "Invalid email event signature.",
            );
          }
          assert.deepEqual(await kept(), []);
          // Each refusal is counted for the alert on signature failures, after its answer has gone.
          const deadline = Date.now() + 10_000;
          while ((await signatureFailures()) < before + refused.length && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 100));
          assert.ok((await signatureFailures()) >= before + refused.length);
        },
      );

      await t.test(
        "a signed report is kept before it is answered, with the least it needs, and a second delivery of it is the same report",
        async () => {
          const body = event("email.bounced");
          const id = newId();
          const first = await post(body, signature(body, id));
          assert.equal(first.status, 200);
          assert.deepEqual(ack.parse(await first.json()), { received: true, kept: true, duplicate: false });
          // The provider sends it again, signed anew: still one report.
          const again = await post(body, signature(body, id, Date.now() + 1000));
          assert.equal(again.status, 200);
          assert.deepEqual(ack.parse(await again.json()), { received: true, kept: true, duplicate: true });
          const rows = await kept();
          assert.equal(rows.length, 1);
          const row = rows[0]!;
          assert.deepEqual(
            [row.provider, row.eventKey, row.delivery, row.detail, row.providerMessageId, row.status],
            ["resend", id, "bounced", "PERMANENT", reference, "pending"],
          );
          assert.equal(row.settledAt, null);
          // Nothing of the address, the subject or the provider's own words is in the row. For this
          // bounce, which the provider calls permanent, the address's keyed checksum is.
          assert.doesNotMatch(JSON.stringify(row), /example\.test|SYNTHETIC|synthetic-recipient/);
          assert.match(row.addressHash!, /^[a-f0-9]{64}$/);
          assert.ok(row.addressKeyVersion);
          assert.deepEqual(Object.keys(row).sort(), [
            "addressHash",
            "addressKeyVersion",
            "delivery",
            "detail",
            "eventKey",
            "id",
            "occurredAt",
            "provider",
            "providerMessageId",
            "receivedAt",
            "settledAt",
            "status",
          ]);
        },
      );

      await t.test(
        "nothing is kept of an event Valo does not use, or of a signed one it cannot read",
        async () => {
          const before = (await kept()).length;
          for (const type of ["email.sent", "email.opened", "email.clicked"]) {
            const body = event(type);
            const answer = await post(body, signature(body, newId()));
            assert.equal(answer.status, 200, type);
            assert.deepEqual(ack.parse(await answer.json()), { received: true, kept: false });
          }
          for (const body of [
            event("email.delivered", { email_id: undefined }),
            JSON.stringify({ data: { email_id: reference } }),
            "[]",
            "not json",
          ]) {
            const answer = await post(body, signature(body, newId()));
            assert.equal(answer.status, 422, body.slice(0, 40));
          }
          assert.equal((await kept()).length, before);
        },
      );

      await t.test(
        "a compressed or oversized body is refused, and the same listener goes on answering",
        async () => {
          const body = event("email.delivered");
          const id = newId();
          const compressed = await post(Buffer.concat([gzipSync(body), Buffer.from("trailing")]), {
            ...signature(body, id),
            "Content-Encoding": "gzip",
          });
          assert.equal(compressed.status, 415);
          const large = JSON.stringify({ type: "email.delivered", padding: "x".repeat(70_000) });
          assert.equal((await post(large, signature(large, id))).status, 413);
          const alive = await post(body, signature(body, id));
          assert.equal(alive.status, 200);
          assert.deepEqual(ack.parse(await alive.json()), { received: true, kept: true, duplicate: false });
          // A report of delivery names an address too, and no checksum of it is kept.
          const delivered = (await kept()).find((row) => row.eventKey === id)!;
          assert.deepEqual(
            [delivered.delivery, delivered.addressHash, delivered.addressKeyVersion],
            ["delivered", null, null],
          );
        },
      );

      await t.test(
        "the webhook is no way round sign-in, answers nothing to a browser's read, and is off outside development",
        async () => {
          const read = await fetch(base + "/api/webhooks/email");
          assert.ok([401, 404].includes(read.status), String(read.status));
          const privateRead = await fetch(base + "/api/workspace/messages");
          assert.equal(privateRead.status, 401);
          // A deployment's marker turns the webhook off, whatever is signed.
          const body = event("email.delivered");
          process.env.REPLIT_DEPLOYMENT = "1";
          try {
            const answer = await post(body, signature(body, newId()));
            assert.equal(answer.status, 503);
          } finally {
            delete process.env.REPLIT_DEPLOYMENT;
          }
          assert.equal(externalRequests, 0, "no request left this machine");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.VALO_EMAIL_WEBHOOK_SECRET;
      delete process.env.CLERK_SECRET_KEY;
      delete process.env.CLERK_PUBLISHABLE_KEY;
      if (priorTelemetry === undefined) delete process.env.CLERK_TELEMETRY_DISABLED;
      else process.env.CLERK_TELEMETRY_DISABLED = priorTelemetry;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (ids.length) await db.delete(valoEmailEvents).where(inArray(valoEmailEvents.eventKey, ids));
      await pool.end();
    }
  },
);
