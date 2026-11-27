import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError } from "./describe-error";

/** An API failure as the generated client raises it. */
const failure = (status: number, data: unknown = {}) => ({ status, data });

test("each kind of failure says what happened and what to do, in plain words", () => {
  const said = (status: number) => describeError(failure(status)).message;
  assert.equal(said(401), "You are not signed in, or your session has ended.");
  assert.equal(
    said(403),
    "Your account cannot open this. Your email address may still need to be verified, or the account may be suspended.",
  );
  assert.equal(said(404), "We could not find that in your workspace.");
  assert.equal(said(409), "This was changed somewhere else after you opened it.");
  assert.equal(said(400), "Some details were not accepted. Check them and try again.");
  assert.equal(said(422), "Some details were not accepted. Check them and try again.");
  assert.equal(said(429), "Too many requests in a short time. Wait a moment and try again.");
  assert.equal(said(500), "Something went wrong at Valo. Try again in a moment.");
  assert.equal(said(503), "Something went wrong at Valo. Try again in a moment.");
  // No answer at all: the service was not reached.
  assert.deepEqual(describeError(new Error("Failed to fetch")), {
    kind: "offline",
    message: "Valo could not be reached. Check your connection and try again.",
  });
});

test("no message promises that the customer's work is safe, which this function cannot know", () => {
  for (const error of [
    new Error("Failed to fetch"),
    ...[400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map((status) => failure(status)),
  ])
    assert.doesNotMatch(
      describeError(error).message,
      /nothing was lost|unchanged|is safe|was saved/i,
      JSON.stringify(error),
    );
});

test("the server's own sentence is used where it sent one, and a conflict carries the newest version", () => {
  assert.equal(
    describeError(failure(409, { error: "Synthetic: changed in another window.", currentRevision: 7 }))
      .message,
    "Synthetic: changed in another window.",
  );
  assert.equal(describeError(failure(409, { error: "x", currentRevision: 7 })).currentRevision, 7);
  assert.equal(describeError(failure(409, { error: "x", currentRevision: "7" })).currentRevision, undefined);
});

test("a failure at Valo carries the request's own reference, and only a well-formed one", () => {
  assert.equal(describeError(failure(500, { error: "x", requestId: "4821" })).reference, "4821");
  assert.equal(
    describeError(failure(503, { requestId: "0d9c6a1e-5b7f-4c3a-9a44-1f2e3d4c5b6a" })).reference,
    "0d9c6a1e-5b7f-4c3a-9a44-1f2e3d4c5b6a",
  );
  // Not a reference: nothing is shown as one.
  for (const requestId of [4821, "", "<script>", "a".repeat(65), null])
    assert.equal(describeError(failure(500, { requestId })).reference, undefined, String(requestId));
  // Only a failure at Valo is something to report with a reference.
  assert.equal(describeError(failure(404, { requestId: "4821" })).reference, undefined);
  assert.equal(describeError(failure(429, { requestId: "4821" })).reference, undefined);
});

test("offline is said only where the browser reports it; a missing flag is not a report", () => {
  const flag = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  const set = (value: unknown) =>
    Object.defineProperty(globalThis.navigator, "onLine", { value, configurable: true });
  try {
    set(false);
    assert.deepEqual(describeError(failure(500)), {
      kind: "offline",
      message: "You seem to be offline. Reconnect and try again.",
    });
    set(true);
    assert.equal(describeError(failure(500)).kind, "server");
    // As on the server that renders a page: there is a navigator, and it has no such flag.
    set(undefined);
    assert.equal(describeError(failure(404)).kind, "notFound");
  } finally {
    if (flag) Object.defineProperty(globalThis.navigator, "onLine", flag);
    else delete (globalThis.navigator as { onLine?: unknown }).onLine;
  }
});
