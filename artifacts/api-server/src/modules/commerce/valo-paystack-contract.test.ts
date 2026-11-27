import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  authenticPaystackBody,
  verifiedTransaction,
  assertOrderMatch,
  orderDifferences,
  paystack,
  paystackEventFamily,
} from "./valo-paystack-contract";
const raw = Buffer.from('{"event":"charge.success","data":{"id":123, "amount":1.50}}'),
  secret = "whsec_synthetic_control_not_a_credential";
const signature = (t: number, body = raw, key = secret) =>
  `t=${t},v1=whk_control:${createHmac("sha512", key)
    .update(t + ".")
    .update(body)
    .digest("hex")}`;
test("timestamped raw-body authentication, replay bounds and rotation", () => {
  const config = { mode: "timestamped" as const, secrets: [secret] },
    now = 1794600000;
  assert.equal(authenticPaystackBody(raw, signature(now), config, now), true);
  for (const skew of [-301, 301])
    assert.equal(authenticPaystackBody(raw, signature(now + skew), config, now), false);
  for (const skew of [-300, 300])
    assert.equal(authenticPaystackBody(raw, signature(now + skew), config, now), true);
  assert.equal(
    authenticPaystackBody(Buffer.from(raw.toString().replace("1.50", "1.5")), signature(now), config, now),
    false,
  );
  assert.equal(authenticPaystackBody(raw, signature(now) + `,t=${now}`, config, now), false);
  assert.equal(authenticPaystackBody(raw, signature(now).replace("v1=", "v2="), config, now), false);
  assert.equal(
    authenticPaystackBody(raw, signature(now).replace("whk_control:", "bad:"), config, now),
    false,
  );
  assert.equal(authenticPaystackBody(raw, "t=NaN,v1=whk_a:00", config, now), false);
  assert.equal(authenticPaystackBody(raw, signature(now), { mode: "timestamped", secrets: [] }, now), false);
  const second = "whsec_rotated_synthetic_control";
  assert.equal(
    authenticPaystackBody(
      raw,
      `${signature(now, raw, second)},v1=whk_old:00`,
      { mode: "timestamped", secrets: [secret, second] },
      now,
    ),
    true,
  );
  const legacy = "sk_test_synthetic_control_not_a_credential";
  const legacySig = createHmac("sha512", legacy).update(raw).digest("hex");
  assert.equal(authenticPaystackBody(raw, legacySig, { mode: "legacy", apiSecret: legacy }), true);
  assert.equal(
    authenticPaystackBody(raw, legacySig, config, now),
    false,
    "new mode never downgrades to legacy",
  );
  assert.equal(
    authenticPaystackBody(raw, legacySig, { mode: "legacy", apiSecret: "sk_live_not_allowed" }),
    false,
  );
});
test("server verification rejects live domain, unsafe amounts and mismatched immutable order facts", () => {
  const order = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    reference: "valo-test-control",
    amountKobo: 12345,
    currency: "NGN",
  };
  const input = {
    id: 123,
    domain: "test",
    reference: order.reference,
    status: "success",
    amount: 12345,
    currency: "NGN",
    metadata: { valoOrderId: order.id, workspaceId: order.workspaceId },
  };
  const valid = verifiedTransaction.parse(input);
  assert.doesNotThrow(() => assertOrderMatch(order, valid));
  for (const bad of [
    { domain: "live" },
    { amount: 123.45 },
    { amount: 0 },
    { amount: 2147483648 },
    { currency: "USD" },
    { status: "successful" },
    { metadata: {} },
  ])
    assert.equal(verifiedTransaction.safeParse({ ...input, ...bad }).success, false);
  for (const bad of [
    { amount: 12346 },
    { reference: "another-order" },
    { metadata: { ...input.metadata, workspaceId: randomUUID() } },
    { metadata: { ...input.metadata, valoOrderId: randomUUID() } },
  ])
    assert.throws(() => assertOrderMatch(order, verifiedTransaction.parse({ ...input, ...bad })), {
      status: 409,
    });
});
// PAY-007 (docs/architecture/reconciliation.md, slice 1): "alert on unmatched amounts". The daily check
// names what the provider's answer says differently from the order, so that finance reads which it is.
test("what the provider's answer says differently from an order is named: the amount, the transaction, or a reversal the provider does not hold", () => {
  const order = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    reference: "valo-test-control",
    amountKobo: 12345,
    currency: "NGN",
    status: "pending",
    providerTransactionId: null as string | null,
  };
  const input = {
    id: 123,
    domain: "test",
    reference: order.reference,
    status: "success",
    amount: 12345,
    currency: "NGN",
    metadata: { valoOrderId: order.id, workspaceId: order.workspaceId },
  };
  const answer = (patch: Record<string, unknown> = {}) => verifiedTransaction.parse({ ...input, ...patch });
  // Nothing differs: whatever the provider says became of the payment, and for an order that already
  // holds this transaction.
  for (const status of ["success", "abandoned", "failed", "pending", "reversed"])
    assert.deepEqual(orderDifferences(order, answer({ status })), []);
  assert.deepEqual(orderDifferences({ ...order, providerTransactionId: "123" }, answer()), []);
  // The amount, by a kobo either way, and the currency.
  assert.deepEqual(orderDifferences(order, answer({ amount: 12346 })), ["AMOUNT_DIFFERENCE"]);
  assert.deepEqual(orderDifferences(order, answer({ amount: 12344 })), ["AMOUNT_DIFFERENCE"]);
  assert.deepEqual(orderDifferences({ ...order, currency: "USD" }, answer()), ["AMOUNT_DIFFERENCE"]);
  // The transaction is another order's, another workspace's or another reference's, or it is not the
  // one the order already holds.
  for (const other of [
    { reference: "another-order" },
    { metadata: { ...input.metadata, valoOrderId: randomUUID() } },
    { metadata: { ...input.metadata, workspaceId: randomUUID() } },
  ])
    assert.deepEqual(orderDifferences(order, answer(other)), ["TRANSACTION_DIFFERENCE"]);
  assert.deepEqual(orderDifferences({ ...order, providerTransactionId: "124" }, answer()), [
    "TRANSACTION_DIFFERENCE",
  ]);
  // Valo holds the order as reversed and the provider does not.
  for (const status of ["success", "abandoned", "failed", "pending"])
    assert.deepEqual(orderDifferences({ ...order, status: "reversed" }, answer({ status })), [
      "REVERSAL_DIFFERENCE",
    ]);
  assert.deepEqual(orderDifferences({ ...order, status: "reversed" }, answer({ status: "reversed" })), []);
  // Several at once are all named, in one order.
  assert.deepEqual(
    orderDifferences({ ...order, status: "reversed", providerTransactionId: "124" }, answer({ amount: 1 })),
    ["AMOUNT_DIFFERENCE", "TRANSACTION_DIFFERENCE", "REVERSAL_DIFFERENCE"],
  );
  // Whatever the settlement's own comparison refuses is named here too.
  for (const refused of [
    { amount: 12346 },
    { reference: "another-order" },
    { metadata: { ...input.metadata, workspaceId: randomUUID() } },
    { metadata: { ...input.metadata, valoOrderId: randomUUID() } },
  ]) {
    assert.throws(() => assertOrderMatch(order, answer(refused)), { status: 409 });
    assert.notDeepEqual(orderDifferences(order, answer(refused)), []);
  }
});

test("checkout asks Paystack only for a one-time charge, with no plan, split, subaccount or saved card", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const sent: { url: string; method: string | undefined; body: Record<string, unknown> }[] = [];
  Object.assign(process.env, {
    NODE_ENV: "development",
    VALO_SANDBOX_CHECKOUT_ENABLED: "true",
    PAYSTACK_SECRET_KEY: "sk_test_synthetic_control_not_a_credential",
  });
  delete process.env.REPLIT_DEPLOYMENT;
  delete process.env.VALO_ISOLATED_RECOVERY;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url: String(input), method: init?.method, body });
    return Response.json({
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/synthetic", reference: body.reference },
    });
  };
  try {
    const order = {
      reference: "synthetic-order-ref",
      amountKobo: 150000,
      id: randomUUID(),
      workspaceId: randomUUID(),
    };
    const url = await paystack.initialise(
      order,
      "synthetic-buyer@example.invalid",
      "https://valo.example.invalid/return",
    );
    assert.equal(url, "https://checkout.paystack.com/synthetic");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.url, "https://api.paystack.co/transaction/initialize");
    assert.equal(sent[0]!.method, "POST");
    // Exactly the fields of a single charge: no plan, subaccount, split_code, bearer,
    // transaction_charge, invoice_limit or authorization_code can reach Paystack.
    assert.deepEqual(Object.keys(sent[0]!.body).sort(), [
      "amount",
      "callback_url",
      "currency",
      "email",
      "metadata",
      "reference",
    ]);
    assert.equal(sent[0]!.body.currency, "NGN");
    assert.equal(sent[0]!.body.amount, 150000);
    assert.deepEqual(Object.keys(sent[0]!.body.metadata as object).sort(), ["valoOrderId", "workspaceId"]);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

// OPS-001: "integration tests cannot charge production accounts". Every merchant call goes through
// paystackRequest (r1-boundaries.test.ts), which refuses before sending anything unless it runs in
// development, outside a deployment and a recovery run, with sandbox checkout enabled and a test key.
test("no merchant call is made with a live key, in production, in a deployment or in a recovery run", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/synthetic", reference: body.reference },
    });
  };
  const restore = () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  };
  const configure = (change: Record<string, string | undefined>) => {
    restore();
    Object.assign(process.env, {
      NODE_ENV: "development",
      VALO_SANDBOX_CHECKOUT_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "sk_test_synthetic_control_not_a_credential",
    });
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.VALO_ISOLATED_RECOVERY;
    for (const [key, value] of Object.entries(change))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
  const charge = () =>
    paystack.initialise(
      { reference: "synthetic-order-ref", amountKobo: 150000, id: randomUUID(), workspaceId: randomUUID() },
      "synthetic-buyer@example.invalid",
      "https://valo.example.invalid/return",
    );
  try {
    const refused = { status: 503 };
    for (const [why, change, refusal] of [
      ["a live key", { PAYSTACK_SECRET_KEY: "sk_live_synthetic_control_not_a_credential" }, refused],
      ["no key", { PAYSTACK_SECRET_KEY: undefined }, refused],
      ["production", { NODE_ENV: "production" }, refused],
      ["a deployment", { REPLIT_DEPLOYMENT: "1" }, refused],
      ["sandbox checkout not enabled", { VALO_SANDBOX_CHECKOUT_ENABLED: undefined }, refused],
      [
        "an isolated recovery run",
        { VALO_ISOLATED_RECOVERY: "1" },
        { code: "RECOVERY_EXTERNAL_EFFECTS_DISABLED" },
      ],
    ] as const) {
      configure(change);
      await assert.rejects(charge(), refusal, why);
    }
    assert.equal(requests, 0, "no request reached the merchant");
    // The same call in the sandbox does reach the controlled transport, so each refusal above is real.
    configure({});
    assert.equal(await charge(), "https://checkout.paystack.com/synthetic");
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("only one-time charge, refund and dispute events are processed; subscription, invoice and transfer events are not", () => {
  const processed = {
    "charge.success": "charge",
    "refund.processed": "refund",
    "refund.needs-attention": "refund",
    "charge.dispute.create": "dispute",
    "charge.dispute.resolve": "dispute",
  } as const;
  for (const [event, family] of Object.entries(processed))
    assert.equal(paystackEventFamily(event), family, event);
  for (const event of [
    "subscription.create",
    "subscription.disable",
    "subscription.not_renew",
    "invoice.create",
    "invoice.payment_failed",
    "transfer.success",
    "transfer.failed",
    "paymentrequest.success",
    "customeridentification.success",
    "dedicatedaccount.assign.success",
    "charge.successful",
    "refund.unknown",
  ])
    assert.equal(paystackEventFamily(event), undefined, event);
});
