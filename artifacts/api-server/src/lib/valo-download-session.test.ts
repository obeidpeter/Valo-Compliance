import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWorkspaceDownloadSession } from "./valo-download-session";

const actor = { identityId: "synthetic-owner", workspaceId: "synthetic-workspace" };
const auth = { userId: actor.identityId, sessionId: "synthetic-session" };
const user = {
  id: actor.identityId,
  banned: false,
  locked: false,
  primaryEmailAddressId: "primary",
  emailAddresses: [{ id: "primary", verification: { status: "verified" } }],
};
const session = { userId: actor.identityId, status: "active" };

test("download release accepts only the same active session and currently verified primary identity", async () => {
  const calls: string[] = [];
  await assertWorkspaceDownloadSession(actor, auth, {
    session: async (id) => {
      calls.push(id);
      return session;
    },
    user: async (id) => {
      calls.push(id);
      return user;
    },
  });
  assert.deepEqual(calls, [auth.sessionId, auth.userId]);
});
for (const [description, claims] of [
  ["missing user", { ...auth, userId: null }],
  ["missing session", { ...auth, sessionId: null }],
  ["changed requester", { ...auth, userId: "synthetic-other" }],
] as const)
  test(`download rejects ${description} before provider reads`, async () => {
    let effects = 0;
    await assert.rejects(
      () =>
        assertWorkspaceDownloadSession(actor, claims, {
          session: async () => {
            effects++;
            return session;
          },
          user: async () => {
            effects++;
            return user;
          },
        }),
      { status: 401 },
    );
    assert.equal(effects, 0);
  });
for (const [description, changedSession, changedUser, status] of [
  ["revoked session", { ...session, status: "revoked" }, user, 401],
  ["wrong session user", { ...session, userId: "synthetic-other" }, user, 401],
  ["wrong returned user", session, { ...user, id: "synthetic-other" }, 401],
  ["banned identity", session, { ...user, banned: true }, 403],
  ["locked identity", session, { ...user, locked: true }, 403],
  [
    "unverified primary email",
    session,
    { ...user, emailAddresses: [{ id: "primary", verification: { status: "unverified" } }] },
    403,
  ],
  ["missing primary email", session, { ...user, primaryEmailAddressId: "missing" }, 403],
] as const)
  test(`download rejects ${description} at release`, async () => {
    await assert.rejects(
      () =>
        assertWorkspaceDownloadSession(actor, auth, {
          session: async () => changedSession,
          user: async () => changedUser,
        }),
      { status },
    );
  });
test("provider failure holds the file instead of accepting the earlier session check", async () => {
  await assert.rejects(
    () =>
      assertWorkspaceDownloadSession(actor, auth, {
        session: async () => {
          throw new Error("synthetic provider unavailable");
        },
        user: async () => user,
      }),
    /synthetic provider unavailable/,
  );
});
