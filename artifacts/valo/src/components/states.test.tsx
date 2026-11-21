import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { ErrorState } from "./states";

const failure = (status: number, data: unknown = {}) => ({ status, data });
/** The alert as the browser app draws it, on a workspace screen. */
const shown = (error: unknown, title?: string) =>
  renderToStaticMarkup(
    <Router ssrPath="/workspace">
      <ErrorState error={error} {...(title ? { title } : {})} />
    </Router>,
  );
/** The alert's words, without its markup. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("an error is an alert that says what happened in words, with no status code", () => {
  for (const status of [401, 403, 404, 409, 422, 429, 500, 503]) {
    const html = shown(failure(status));
    assert.match(html, /^<div role="alert"[^>]*data-testid="status-error"/, String(status));
    assert.doesNotMatch(words(html), new RegExp(`\\b${status}\\b`), `${status}: ${words(html)}`);
  }
  assert.match(
    words(shown(failure(404))),
    /^We could not load this We could not find that in your workspace\.$/,
  );
  assert.match(words(shown(failure(403))), /^You cannot open this Your account cannot open this\./);
  assert.match(
    words(shown(failure(401))),
    /^Sign in to continue You are not signed in, or your session has ended\. Sign in Trouble signing in$/,
  );
  // A screen may name what could not be loaded.
  assert.match(
    words(shown(failure(500), "Your files could not be loaded")),
    /^Your files could not be loaded /,
  );
});

test("a failure at Valo offers the way to report it, with the request's reference to quote", () => {
  const html = shown(failure(500, { error: "Synthetic failure.", requestId: "4821" }));
  assert.match(
    words(html),
    /Synthetic failure\. If this keeps happening, report a problem and quote reference 4821 \.$/,
  );
  assert.match(html, /<a[^>]*href="\/support"[^>]*>report a problem<\/a>/);
  assert.match(html, /<span class="font-mono">4821<\/span>/);
  // Without a reference the sentence stands without one.
  assert.match(words(shown(failure(503))), /If this keeps happening, report a problem \.$/);
});

test("what the customer can put right alone does not ask to be reported", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429])
    assert.doesNotMatch(
      shown(failure(status, { requestId: "4821" })),
      /report a problem|4821/,
      String(status),
    );
  assert.doesNotMatch(shown(new Error("Failed to fetch")), /report a problem/);
});
