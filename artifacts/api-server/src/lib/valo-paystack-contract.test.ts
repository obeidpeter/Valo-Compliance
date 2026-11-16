import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { authenticPaystackBody, verifiedTransaction, assertOrderMatch } from "./valo-paystack-contract";
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
