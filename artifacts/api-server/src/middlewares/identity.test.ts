import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

/**
 * OWASP ASVS 5.0.0 V9.2.3 in the security baseline: the API accepts a sign-in token only when it was
 * made for Valo's own site. The identity provider's library checks a session token against a key it
 * is given, without its servers, so every token here is made in the test, for a synthetic instance,
 * and signed with a key made for the test alone. Nothing reaches the provider.
 */

const TRUSTED = "https://valo.synthetic.invalid";
const FRONTEND_API = "synthetic-instance.clerk.accounts.dev";
const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A session token, as the provider would sign one, with the given claims over a sound set. */
function sessionToken(claims: Record<string, unknown>, key: KeyObject = signer.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: "RS256", typ: "JWT", kid: "ins_synthetic" });
  const body = encode({
    sub: "user_synthetic_identity",
    sid: "sess_synthetic_identity",
    iss: `https://${FRONTEND_API}`,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 60,
    ...claims,
  });
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url");
  return `${head}.${body}.${signature}`;
}

test("a sign-in token is accepted only when it was made for Valo's own site, and only as the provider signed it", async () => {
  const settings = {
    CLERK_JWT_KEY: signer.publicKey.export({ type: "spki", format: "pem" }).toString(),
    CLERK_SECRET_KEY: "sk_test_" + "synthetic".repeat(4),
    CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from(`${FRONTEND_API}$`).toString("base64"),
    CLERK_TELEMETRY_DISABLED: "1",
    VALO_TRUSTED_ORIGIN: TRUSTED,
  };
  const before = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const { getAuth } = await import("@clerk/express");
  const { identityMiddleware } = await import("./identity");
  const app = express();
  app.use(identityMiddleware());
  app.get("/who", (req, res) => {
    res.json({ userId: getAuth(req).userId ?? null });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const who = async (token: string) => {
    const answer = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/who`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return ((await answer.json()) as { userId: string | null }).userId;
  };
  try {
    // A token the provider made for Valo's own site signs its holder in.
    assert.equal(await who(sessionToken({ azp: TRUSTED })), "user_synthetic_identity");
    // The same token made for another site, or for no site, signs no one in.
    assert.equal(await who(sessionToken({ azp: "https://hostile.synthetic.invalid" })), null);
    assert.equal(await who(sessionToken({ azp: `${TRUSTED}.hostile.synthetic.invalid` })), null);
    assert.equal(await who(sessionToken({})), null);
    // A token for Valo's site signed with another key, or past its time, signs no one in.
    assert.equal(await who(sessionToken({ azp: TRUSTED }, stranger.privateKey)), null);
    const now = Math.floor(Date.now() / 1000);
    assert.equal(
      await who(sessionToken({ azp: TRUSTED, iat: now - 600, nbf: now - 600, exp: now - 300 })),
      null,
    );
  } finally {
    server.close();
    for (const [key, value] of Object.entries(before))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
