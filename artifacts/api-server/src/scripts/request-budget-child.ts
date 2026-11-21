import { mock } from "node:test";

// Checked before the app loads, so nothing of it runs outside this synthetic local harness.
if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_REQUEST_BUDGET_TESTS !== "synthetic-development-only" ||
  !process.send
)
  throw Error("Synthetic local IPC harness only");

// Every request here comes from a signed-out visitor, so the identity provider stands in for
// one, as in the other HTTP tests. The body limits under test run before it in app.ts; without
// the provider's keys the real one refuses every request, and the API would give no answer but
// its generic unavailable reply.
mock.module("@clerk/express", {
  namedExports: {
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: null, sessionId: null, sessionClaims: null, has: () => false }),
    clerkClient: {},
  },
});
const { default: app } = await import("../app");

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.send?.({ port: address.port });
});
