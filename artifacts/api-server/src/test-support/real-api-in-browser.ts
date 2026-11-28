import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { Api } from "./app-in-browser";

/** The header that names the synthetic account a request is from, in place of the identity
 * provider's session. */
export const IDENTITY_HEADER = "x-synthetic-identity";

/** What the server answered one request: its method, path, status and headers. */
export type Answered = { method: string; path: string; status: number; headers: Record<string, string> };

/**
 * The real API on this machine, for the tests that draw the web app in a browser against it: the
 * web app's own code talks to the server's own code and its database, so a request the page sends
 * that the server refuses, or an answer the page cannot draw, fails the test before it stops a
 * person.
 *
 * What is stood in for, and nothing else: the identity provider (its script cannot load in a test,
 * so the page is bundled with a signed-in or signed-out stand-in and the server is told by a header
 * which of the test's synthetic accounts asks; any other request is signed out), and the queue's
 * worker (a file the page asks for is made by the function the worker calls, after the page has its
 * answer, so the page shows it waiting and then ready). No provider is called and every record is
 * synthetic.
 *
 * Call it before anything imports the app: it stands in for the identity library first.
 */
export async function startRealApi(t: TestContext, accounts: readonly string[]) {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
  for (const account of accounts) assert.match(account, /^synthetic-/);
  t.mock.module("@clerk/express", {
    namedExports: {
      clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
      getAuth: (req: Request) => {
        const asked = req.header(IDENTITY_HEADER);
        const id = asked && accounts.includes(asked) ? asked : null;
        return { userId: id, sessionId: id ? `sess_${id}` : null, sessionClaims: null, has: () => false };
      },
      clerkClient: {
        sessions: {
          getSession: async (id: string) => ({ status: "active", userId: id.slice("sess_".length) }),
        },
        users: {
          getUser: async (id: string) => ({
            id,
            banned: false,
            locked: false,
            twoFactorEnabled: false,
            primaryEmailAddressId: "primary",
            emailAddresses: [
              {
                id: "primary",
                emailAddress: "synthetic-accessibility@example.test",
                verification: { status: "verified" },
              },
            ],
          }),
        },
      },
    },
  });
  const { default: app } = await import("../app");
  const { pool } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { executeExport, getExport } = await import("../modules/exports");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = `http://127.0.0.1:${address.port}`;

  /** What the server answered, for the checks: method, path and status of each request. */
  const answered: Answered[] = [];
  /** The files being made for the page, each settling to what went wrong, or to nothing. */
  const made: Promise<unknown>[] = [];
  let closing = false;
  /** Passes each request the page makes to the real API, as the account given, and hands back its answer. */
  const through =
    (account: string | null): Api =>
    async (route, method, path, query) => {
      try {
        const headers = await route.request().allHeaders();
        delete headers.host;
        if (account) headers[IDENTITY_HEADER] = account;
        const search = query.toString();
        const reply = await route.fetch({ url: `${api}/api${path}${search ? `?${search}` : ""}`, headers });
        answered.push({ method, path, status: reply.status(), headers: reply.headers() });
        // In place of the queue's worker: a file the page asked for is made by the worker's own
        // function, after the page has its answer, so the page shows it waiting and then ready.
        if (
          account &&
          method === "POST" &&
          /^\/v1\/documents\/[^/]+\/exports$/.test(path) &&
          reply.status() === 202
        ) {
          const { id } = (await reply.json()) as { id: string };
          made.push(
            (async () => {
              const { job } = await getExport(await resolveWorkspace(account), id);
              await executeExport(job.id, job.workspaceId, job.queueId);
            })().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        }
        await route.fulfill({ response: reply });
      } catch (error) {
        // A request still on its way when its page is closed has no one to answer.
        if (!closing) throw error;
      }
    };
  return {
    /** The API's own address, as `http://127.0.0.1:<port>`. */
    api,
    answered,
    made,
    through,
    /** The requests the server refused or failed, which no step expects. */
    refused: () =>
      answered
        .filter((each) => each.status >= 400)
        .map((each) => `${each.status} ${each.method} ${each.path}`),
    /** Closes a page: a request still on its way then has no one to answer. */
    closePage: async (close: () => Promise<void>) => {
      closing = true;
      try {
        await close();
      } finally {
        closing = false;
      }
    },
    /** Waits for the files still being made, then stops the server and its database pool. */
    close: async () => {
      await Promise.all(made);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    },
  };
}
