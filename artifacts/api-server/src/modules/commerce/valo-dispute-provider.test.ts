import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  makeDisputeTransport,
  matchDispute,
  resolutionPayload,
  validateDisputeUpload,
} from "./valo-dispute-provider";
const now = Date.parse("2026-11-14T12:00:00Z");
const target =
  "https://s3.eu-west-1.amazonaws.com/files.paystack.co/receipt?X-Amz-Date=20261114T115900Z&X-Amz-Expires=1800";
const context = {
  providerId: "624",
  transactionId: "5991760",
  reference: "synthetic-selected-order",
  amountKobo: 10000,
};
const canonical = () => ({
  id: 624,
  domain: "test",
  status: "awaiting-merchant-feedback",
  resolution: null,
  refund_amount: null,
  currency: "NGN",
  category: "general",
  transaction: { id: 5991760, domain: "test", reference: context.reference, amount: 10000, currency: "NGN" },
});
const pdf = Buffer.from("%PDF-1.7\nControlled receipt bytes only\n%%EOF");
test("dispute transport: official operations with controlled HTTP, not merchant execution", async (t) => {
  await t.test("disabled and recovery paths have zero outbound effects", async () => {
    let calls = 0;
    const p = makeDisputeTransport(async () => {
      calls++;
      return canonical();
    });
    await assert.rejects(() => p.fetch(context), { status: 503 });
    assert.equal(calls, 0);
    const old = process.env.VALO_ISOLATED_RECOVERY;
    try {
      process.env.VALO_ISOLATED_RECOVERY = "synthetic-isolated";
      const enabled = makeDisputeTransport(
        async () => {
          calls++;
          return canonical();
        },
        fetch,
        () => true,
      );
      await assert.rejects(() => enabled.fetch(context), /RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
      assert.equal(calls, 0);
    } finally {
      if (old === undefined) delete process.env.VALO_ISOLATED_RECOVERY;
      else process.env.VALO_ISOLATED_RECOVERY = old;
    }
  });
  await t.test("scope checks cover dispute, environment, reference, transaction, currency and amount", () => {
    for (const mutation of [
      { id: 625 },
      { domain: "live" },
      { currency: "USD" },
      { transaction: { ...canonical().transaction, reference: "another-order" } },
      { transaction: { ...canonical().transaction, id: 2 } },
      { transaction: { ...canonical().transaction, amount: 10001 } },
      { transaction: { ...canonical().transaction, currency: "USD" } },
      { refund_amount: 10001 },
    ]) {
      assert.throws(() => matchDispute(context, { ...canonical(), ...mutation }));
    }
  });
  await t.test("full and partial accept are exact integer-subunit requests, not outcome assertions", () => {
    for (const amountKobo of [1, 4500, 10000]) {
      const body = resolutionPayload(
        { resolution: "merchant-accepted", amountKobo, message: "Accept controlled test claim." },
        10000,
      );
      assert.equal(body.refund_amount, amountKobo);
      assert.equal(body.resolution, "merchant-accepted");
    }
    for (const amountKobo of [0, -1, 0.01, 10001, NaN, Infinity, "1000"])
      assert.throws(() =>
        resolutionPayload(
          {
            resolution: "merchant-accepted",
            amountKobo: amountKobo as number,
            message: "Controlled invalid amount.",
          },
          10000,
        ),
      );
    assert.throws(() =>
      resolutionPayload(
        { resolution: "won" as never, amountKobo: 1, message: "Not a supported decision." },
        10000,
      ),
    );
  });
  await t.test("declines require provider filename; no guessed evidence IDs or delivery dates", async () => {
    assert.throws(() =>
      resolutionPayload(
        { resolution: "declined", amountKobo: 0, message: "Decline controlled claim." },
        10000,
      ),
    );
    assert.throws(() =>
      resolutionPayload(
        {
          resolution: "declined",
          amountKobo: 0,
          message: "Decline controlled claim.",
          uploadedFilename: "../private",
        },
        10000,
      ),
    );
    assert.throws(() =>
      resolutionPayload(
        {
          resolution: "declined",
          amountKobo: 0,
          message: "Decline controlled claim.",
          uploadedFilename: "known-file",
          evidenceId: "99999999999999999999",
        },
        10000,
      ),
    );
    let posts = 0;
    const p = makeDisputeTransport(
      async (_path, _body, method) => {
        if (method === "POST") posts++;
        return canonical();
      },
      fetch,
      () => true,
    );
    await assert.rejects(() =>
      p.evidence(context, {
        customer_email: "fixture@example.invalid",
        customer_name: "Explicit fixture",
        customer_phone: "08000000000",
        service_details: "User-stated synthetic service",
        delivery_date: "2026-02-30",
      }),
    );
    assert.equal(posts, 0);
  });
  await t.test("upload acknowledges empty 204 using a separate no-Authorization client", async () => {
    const calls: { path: string; method?: string | undefined }[] = [],
      sent: RequestInit[] = [];
    const p = makeDisputeTransport(
      async (path, _body, method) => {
        calls.push({ path, method });
        return path.includes("upload_url")
          ? { signedUrl: target, fileName: "provider-file-624" }
          : canonical();
      },
      (async (_url, init) => {
        sent.push(init!);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      () => true,
      () => now,
    );
    const receipt = await p.upload(context, "valo-receipt-624.pdf", pdf);
    assert.equal(receipt.filename, "provider-file-624");
    assert.equal(receipt.checksum, createHash("sha256").update(pdf).digest("hex"));
    assert.equal(calls[1]!.path, "/dispute/624/upload_url?upload_filename=valo-receipt-624.pdf");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.method, "PUT");
    assert.equal(sent[0]!.redirect, "error");
    assert.equal(new Headers(sent[0]!.headers).has("Authorization"), false);
    assert.equal(new Headers(sent[0]!.headers).get("Content-Type"), "application/pdf");
    assert.deepEqual(Buffer.from(sent[0]!.body as Uint8Array), pdf);
  });
  await t.test("destination expiry, host, credentials, traversal and overlong validity are rejected", () => {
    assert.equal(validateDisputeUpload(target, now), target);
    for (const u of [
      target.replace("https:", "http:"),
      target.replace("s3.eu-west-1.amazonaws.com", "127.0.0.1"),
      target.replace("files.paystack.co/receipt", "other-bucket/receipt"),
      target.replace("https://", "https://credential@"),
      target.replace("1800", "1801"),
      target.replace("1800", "0"),
      target.replace("20261114T115900Z", "20261114T110000Z"),
      target + "#private",
      target.replace("1800", "NaN"),
    ]) {
      assert.throws(() => validateDisputeUpload(u, now));
    }
  });
  await t.test("bad/expired destination and arbitrary bytes never reach object upload", async () => {
    let calls = 0;
    const p = makeDisputeTransport(
      async (path) =>
        path.includes("upload_url")
          ? { signedUrl: target.replace("1800", "0"), fileName: "known-file" }
          : canonical(),
      (async () => {
        calls++;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
      () => true,
      () => now,
    );
    await assert.rejects(() => p.upload(context, "receipt.pdf", pdf));
    assert.equal(calls, 0);
    await assert.rejects(() =>
      p.upload(context, "receipt.pdf", Buffer.from("arbitrary customer attachment")),
    );
    assert.equal(calls, 0);
  });
  await t.test("structured evidence uses exact fields and matches the returned dispute", async () => {
    const supplied = {
      customer_email: "fixture@example.invalid",
      customer_name: "Explicit fixture",
      customer_phone: "08000000000",
      service_details: "Explicit synthetic customer statement",
    };
    let payload: unknown;
    const p = makeDisputeTransport(
      async (path, body, method) => {
        if (method === "POST") {
          assert.equal(path, "/dispute/624/evidence");
          payload = body;
          return { id: 21, dispute: 624 };
        }
        return canonical();
      },
      fetch,
      () => true,
    );
    assert.deepEqual(await p.evidence(context, supplied), { evidenceId: "21" });
    assert.deepEqual(payload, supplied);
    assert.equal("delivery_date" in (payload as object), false);
    const bad = makeDisputeTransport(
      async (_p, _b, method) => (method === "POST" ? { id: 21, dispute: 625 } : canonical()),
      fetch,
      () => true,
    );
    await assert.rejects(() => bad.evidence(context, supplied), { status: 409 });
  });
  await t.test(
    "fraud declines require structured evidence; API success never implies bank victory",
    async () => {
      const mutations: unknown[] = [];
      const p = makeDisputeTransport(
        async (_path, body, method) => {
          if (method === "PUT") {
            mutations.push(body);
            return { status: "archived", resolution: null };
          }
          return { ...canonical(), category: "fraud" };
        },
        fetch,
        () => true,
      );
      await assert.rejects(
        () =>
          p.resolve(context, {
            resolution: "declined",
            amountKobo: 0,
            message: "Controlled fraud response.",
            uploadedFilename: "known-file",
          }),
        { status: 422 },
      );
      assert.equal(mutations.length, 0);
      assert.equal(
        await p.resolve(context, {
          resolution: "declined",
          amountKobo: 0,
          message: "Controlled fraud response.",
          uploadedFilename: "known-file",
          evidenceId: "21",
        }),
        undefined,
      );
      assert.deepEqual(mutations, [
        {
          resolution: "declined",
          message: "Controlled fraud response.",
          refund_amount: 0,
          uploaded_filename: "known-file",
          evidence: 21,
        },
      ]);
    },
  );
  await t.test("fraud acceptance can refund without fabricated evidence or delivery details", async () => {
    const mutations: unknown[] = [];
    let evidencePosts = 0;
    const p = makeDisputeTransport(
      async (path, body, method) => {
        if (method === "POST") evidencePosts++;
        if (method === "PUT") {
          assert.equal(path, "/dispute/624/resolve");
          mutations.push(body);
          return { status: "resolved", resolution: "merchant-accepted" };
        }
        return { ...canonical(), category: "fraud" };
      },
      fetch,
      () => true,
    );
    for (const amountKobo of [4500, 10000])
      await p.resolve(context, {
        resolution: "merchant-accepted",
        amountKobo,
        message: "Accept controlled fraud claim.",
      });
    assert.equal(evidencePosts, 0);
    assert.deepEqual(
      mutations,
      [4500, 10000].map((refund_amount) => ({
        resolution: "merchant-accepted",
        message: "Accept controlled fraud claim.",
        refund_amount,
      })),
    );
  });
  await t.test("timeout after acceptance makes only one mutation attempt", async () => {
    let calls = 0;
    const p = makeDisputeTransport(
      async (_path, _body, method) => {
        if (method === "PUT") {
          calls++;
          throw Error("Controlled uncertain acceptance");
        }
        return canonical();
      },
      fetch,
      () => true,
    );
    await assert.rejects(() =>
      p.resolve(context, {
        resolution: "merchant-accepted",
        amountKobo: 10000,
        message: "Explicit controlled acceptance.",
      }),
    );
    assert.equal(calls, 1);
  });
  await t.test("terminal, pending and bank-feedback states prevent a new mutation", async () => {
    for (const status of ["archived", "resolved", "pending", "awaiting-bank-feedback"]) {
      let calls = 0;
      const p = makeDisputeTransport(
        async (_p, _b, method) => {
          if (method === "PUT") calls++;
          return { ...canonical(), status };
        },
        fetch,
        () => true,
      );
      await assert.rejects(
        () =>
          p.resolve(context, {
            resolution: "merchant-accepted",
            amountKobo: 100,
            message: "Controlled held decision.",
          }),
        { status: 409 },
      );
      assert.equal(calls, 0);
    }
  });
});
