import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSessionVerifier,
  routeUsesCachedCheck,
  SESSION_CACHE_TTL_MS,
  type ProviderSession,
  type ProviderUser,
} from "./session-verification";

const id = "11111111-1111-4111-8111-111111111111";

test("only listed everyday routes may use a cached check", () => {
  for (const path of [
    "/api/workspace",
    "/api/workspace/",
    "/api/workspace/profile",
    "/api/workspace/documents",
    `/api/workspace/documents/${id}`,
    `/api/workspace/documents/${id}/revisions`,
    `/api/workspace/templates/${id}/draft`,
    "/api/workspace/saved-templates",
    `/api/workspace/saved-templates/by-template/tpl-01`,
    "/api/workspace/checker/preview",
    `/api/workspace/assessments/${id}/compare/${id}`,
    "/api/workspace/tasks/page",
    "/api/workspace/reminder-preferences",
    "/api/workspace/reminders",
    "/api/workspace/support",
    "/api/workspace/ai-usage",
    `/api/v1/documents/${id}/exports`,
    `/api/v1/exports/${id}/retry`,
    "/API/WORKSPACE/DOCUMENTS",
  ])
    assert.equal(routeUsesCachedCheck(path), true, path);
  for (const path of [
    "/api/workspace/orders",
    `/api/workspace/orders/${id}/checkout`,
    `/api/workspace/orders/${id}/refund`,
    `/api/workspace/orders/${id}/receipt`,
    `/api/workspace/orders/${id}/concerns`,
    `/api/workspace/orders/${id}/dispute-information`,
    "/api/workspace/purchases",
    `/api/workspace/concerns/${id}/respond`,
    "/api/workspace/disputes",
    "/api/workspace/account",
    "/api/workspace/privacy-requests",
    `/api/workspace/privacy-cases/${id}/verify`,
    "/api/workspace/data-export",
    `/api/workspace/data-exports/${id}/download`,
    `/api/workspace/templates/${id}/files/pdf`,
    "/api/workspace/ai-drafts",
    `/api/workspace/ai-drafts/${id}/accept`,
    `/api/v1/exports/${id}/file`,
    "/API/WORKSPACE/ORDERS",
    "//api//workspace//orders",
    `/api/workspace/documents/${id}/share`,
    "/api/workspace/some-future-route",
  ])
    assert.equal(routeUsesCachedCheck(path), false, path);
});

type Provider = {
  session: ProviderSession;
  user: ProviderUser;
  calls: number;
  fail: boolean;
};

function provider(userId = "user_synthetic"): Provider {
  return {
    session: { status: "active", userId },
    user: {
      id: userId,
      banned: false,
      locked: false,
      primaryEmailAddressId: "primary",
      emailAddresses: [
        { id: "primary", emailAddress: "synthetic@example.invalid", verification: { status: "verified" } },
      ],
    },
    calls: 0,
    fail: false,
  };
}

function verifier(state: Provider, clock: { now: number }, options: { maxEntries?: number } = {}) {
  return makeSessionVerifier({
    session: async () => {
      state.calls++;
      if (state.fail) throw new Error("synthetic provider outage");
      return { ...state.session };
    },
    user: async () => structuredClone(state.user),
    now: () => clock.now,
    ...options,
  });
}

const identity = { userId: "user_synthetic", sessionId: "sess_synthetic" };

test("everyday routes recheck the provider at least once a minute", async () => {
  const state = provider(),
    clock = { now: 1_000_000 },
    sessions = verifier(state, clock);
  const first = await sessions.verify(identity, "cached");
  assert.deepEqual(first, {
    ok: true,
    source: "live",
    account: { identityId: "user_synthetic", contactEmail: "synthetic@example.invalid" },
  });
  state.session.status = "revoked";
  clock.now += SESSION_CACHE_TTL_MS - 1;
  assert.equal((await sessions.verify(identity, "cached")).ok, true, "within the minute");
  assert.equal(state.calls, 1);
  clock.now += 1;
  assert.deepEqual(await sessions.verify(identity, "cached"), {
    ok: false,
    status: 401,
    error: "Session is no longer active. Sign in again.",
  });
  assert.equal(state.calls, 2);
});

test("sensitive routes always check live, and a refusal ends cached access", async () => {
  const state = provider(),
    clock = { now: 0 },
    sessions = verifier(state, clock);
  await sessions.verify(identity, "cached");
  await sessions.verify(identity, "live");
  assert.equal(state.calls, 2);
  state.user.banned = true;
  assert.equal((await sessions.verify(identity, "live")).ok, false);
  const next = await sessions.verify(identity, "cached");
  assert.equal(next.ok, false, "the cached pass was removed by the live refusal");
  assert.equal(state.calls, 4);
  assert.equal(sessions.cachedSessions(), 0);
});

test("refusals are never cached, so a newly verified email works at once", async () => {
  const state = provider(),
    clock = { now: 0 },
    sessions = verifier(state, clock);
  state.user.emailAddresses[0]!.verification = { status: "unverified" };
  const refused = await sessions.verify(identity, "cached");
  assert.equal(refused.ok || refused.status, 403);
  state.user.emailAddresses[0]!.verification = { status: "verified" };
  assert.equal((await sessions.verify(identity, "cached")).ok, true);
  state.user.locked = true;
  clock.now += SESSION_CACHE_TTL_MS;
  const locked = await sessions.verify(identity, "cached");
  assert.equal(locked.ok || locked.error, "Account is suspended or locked");
});

test("each session is checked on its own, and another user's session never passes", async () => {
  const state = provider(),
    clock = { now: 0 },
    sessions = verifier(state, clock);
  await sessions.verify(identity, "cached");
  await sessions.verify({ ...identity, sessionId: "sess_other" }, "cached");
  assert.equal(state.calls, 2);
  state.session.userId = "user_someone_else";
  clock.now += SESSION_CACHE_TTL_MS;
  assert.equal((await sessions.verify(identity, "cached")).ok, false);
});

test("a provider outage fails the request and leaves earlier passes unchanged", async () => {
  const state = provider(),
    clock = { now: 0 },
    sessions = verifier(state, clock);
  await sessions.verify(identity, "cached");
  state.fail = true;
  await assert.rejects(sessions.verify(identity, "live"), /synthetic provider outage/);
  assert.equal((await sessions.verify(identity, "cached")).ok, true, "everyday work continues");
  clock.now += SESSION_CACHE_TTL_MS;
  await assert.rejects(sessions.verify(identity, "cached"), /synthetic provider outage/);
});

test("parallel everyday requests share one provider check and the cache is bounded", async () => {
  const state = provider(),
    clock = { now: 0 },
    sessions = verifier(state, clock, { maxEntries: 2 });
  const results = await Promise.all(Array.from({ length: 5 }, () => sessions.verify(identity, "cached")));
  assert.ok(results.every((result) => result.ok));
  assert.equal(state.calls, 1);
  for (const sessionId of ["sess_a", "sess_b", "sess_c"])
    await sessions.verify({ ...identity, sessionId }, "cached");
  assert.equal(sessions.cachedSessions(), 2);
  state.calls = 0;
  await sessions.verify(identity, "cached");
  assert.equal(state.calls, 1, "the oldest session was evicted and checks live again");
});
