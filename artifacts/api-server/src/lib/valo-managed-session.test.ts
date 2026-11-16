import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import { createCheckAuthorization } from "@clerk/shared/authorization";
import { makeVerifiedStaffSession, hasRecentBothFactors } from "./valo-managed-session";
import { createSessionVerificationRouter } from "../routes/valo-session-verification";
import { ValoProblem } from "./valo-problem";

function fixture() {
  const state = {
    ages: [0, 0] as unknown,
    enrolled: true,
    status: "active",
    banned: false,
    locked: false,
    verified: true,
    userId: "user_controlled",
    sessionUserId: "user_controlled",
    accountId: "user_controlled",
    sessionId: "session_controlled",
    outage: false,
  };
  const authenticate = makeVerifiedStaffSession({
    auth: () => ({
      userId: state.userId,
      sessionId: state.sessionId,
      sessionClaims: { fva: state.ages },
      has: createCheckAuthorization({
        userId: state.userId,
        orgId: null,
        orgRole: null,
        orgPermissions: null,
        features: null,
        plans: null,
        factorVerificationAge: state.ages as [number, number],
      }),
    }),
    session: async () => {
      if (state.outage) throw Error("CONTROLLED_PROVIDER_OUTAGE");
      return { status: state.status, userId: state.sessionUserId };
    },
    user: async () => ({
      id: state.accountId,
      banned: state.banned,
      locked: state.locked,
      twoFactorEnabled: state.enrolled,
      primaryEmailAddressId: "primary",
      emailAddresses: [
        { id: "primary", verification: { status: state.verified ? "verified" : "unverified" } },
      ],
    }),
  });
  return { state, authenticate };
}
test("the pinned Clerk helper downgrades absent second factors; Valo must not", async () => {
  const has = createCheckAuthorization({
    userId: "user_controlled",
    orgId: null,
    orgRole: null,
    orgPermissions: null,
    features: null,
    plans: null,
    factorVerificationAge: [0, -1],
  });
  assert.equal(has({ reverification: "strict_mfa" }), true, "SDK behavior that caused the regression");
  const { state, authenticate } = fixture();
  state.ages = [0, -1];
  assert.equal((await authenticate({} as Request)).recentMfa, false);
  state.ages = [0, 0];
  state.enrolled = false;
  assert.equal((await authenticate({} as Request)).recentMfa, false);
  state.enrolled = true;
  assert.equal((await authenticate({} as Request)).recentMfa, true);
});
test("missing, malformed, future and stale factor ages cannot establish MFA", () => {
  for (const ages of [
    null,
    undefined,
    [],
    [0],
    [0, -1],
    [-1, 0],
    [0, 10],
    [10, 0],
    [0, NaN],
    [Infinity, 0],
    ["0", 0],
    [0, 0, 0],
    [0, 0.1],
  ])
    assert.equal(hasRecentBothFactors(ages), false);
  assert.equal(hasRecentBothFactors([0, 9]), true);
});
test("read-only MFA endpoint checks live identity every time, denies revoked sessions and returns no identifiers", async () => {
  const { state, authenticate } = fixture(),
    app = express();
  app.use(createSessionVerificationRouter(authenticate));
  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) =>
    res.status(error instanceof ValoProblem ? error.status : 503).json({ error: "Verification unavailable" }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/session/mfa";
  try {
    let response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.verified, true);
    assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "verified"]);
    state.ages = [0, -1];
    response = await fetch(url);
    assert.equal(response.status, 403);
    assert.equal(
      ((await response.json()) as { clerk_error: { metadata: { reverification: string } } }).clerk_error
        .metadata.reverification,
      "strict_mfa",
    );
    state.enrolled = false;
    response = await fetch(url);
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, "MFA_ENROLLMENT_REQUIRED");
    state.enrolled = true;
    state.ages = [0, 0];
    for (const patch of [
      { status: "revoked" },
      { sessionUserId: "user_other" },
      { accountId: "user_other" },
      { banned: true },
      { locked: true },
      { verified: false },
    ]) {
      const before = { ...state };
      Object.assign(state, patch);
      assert.equal((await fetch(url)).status, 403);
      Object.assign(state, before);
    }
    state.outage = true;
    assert.equal((await fetch(url)).status, 503);
    state.outage = false;
    state.sessionId = "";
    assert.equal(
      (await fetch(url, { headers: { "x-user-id": "user_controlled", "x-mfa": "true" } })).status,
      401,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
