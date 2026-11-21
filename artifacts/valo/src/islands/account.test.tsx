import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountLinksFor } from "./account";
import type { Identity } from "./identity-store";

/**
 * The account links of a server-rendered public page, drawn for each kind of visitor. No browser
 * test sees these pages signed in, because the identity provider cannot load in a test; this draws
 * the same component with a synthetic signed-in visitor. It checks what is drawn, not how the menu
 * behaves: the account menu is opened and closed in the browser app's tests.
 */
const signedIn: Identity = {
  status: "signed-in",
  email: "synthetic-header@example.test",
  initials: "S",
  signOut: async () => undefined,
};
const draw = (identity: Identity, place: "header" | "menu") =>
  renderToStaticMarkup(React.createElement(AccountLinksFor, { identity, place }));
/** Each link drawn, as its address and its words. */
const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => [
    m[1],
    m[2]!.replace(/<[^>]+>/g, ""),
  ]);
const ACCOUNT = [
  ["/workspace/account", "Sign-in and security"],
  ["/workspace/privacy", "Privacy and data"],
  ["/workspace/purchases", "Purchases"],
];

test("signed in, a server-rendered page's header has the workspace, the account menu with its three pages, closed, and sign out", () => {
  const html = draw(signedIn, "header");
  assert.deepEqual(links(html), [["/workspace", "Workspace"], ...ACCOUNT]);
  // The menu is a button that says it is closed and names the list it shows, which starts hidden.
  const button = /<button\b[^>]*data-testid="button-account-menu"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(button, /aria-expanded="false"/);
  assert.match(button, /aria-label="Account menu"/);
  const list = /aria-controls="([^"]+)"/.exec(button)?.[1];
  assert.ok(list, button);
  assert.ok(html.includes(`<ul id="${list}" hidden=""`), html);
  assert.match(html, /<button\b[^>]*aria-label="Sign out"[^>]*data-testid="button-signout"/);
  // The person's address is the button's tooltip only: it is not written into the page's text.
  assert.equal(html.replace(/<[^>]+>/g, "").includes("synthetic-header@example.test"), false);
});

test("signed in, the phone's menu on a server-rendered page lists the workspace, the account's three pages and sign out", () => {
  const html = draw(signedIn, "menu");
  assert.deepEqual(links(html), [["/workspace", "Workspace"], ...ACCOUNT]);
  assert.match(html, /<nav\b[^>]*aria-label="Account"/);
  assert.match(html, /<button\b[^>]*data-testid="button-signout-menu"[^>]*>.*Sign out<\/button>/);
  assert.equal(html.includes("button-account-menu"), false, "the phone's menu lists the pages outright");
});

test("a visitor not known to be signed in gets the sign-in and create-account links, in the header and in the menu", () => {
  for (const identity of [{ status: "unknown" }, { status: "signed-out" }] as const)
    for (const place of ["header", "menu"] as const)
      assert.deepEqual(
        links(draw(identity, place)),
        [
          ["/sign-in", "Sign in"],
          ["/sign-up", "Create account"],
        ],
        `${identity.status} in the ${place}`,
      );
});
