import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isServerPage } from "./server-pages";
import {
  PUBLIC_QUICK_ITEMS,
  WORKSPACE_QUICK_ITEMS,
  filterQuickFinderItems,
  type QuickFinderItem,
} from "./quick-finder";

test("filterQuickFinderItems ranks prefix and label matches ahead of keyword matches", () => {
  const items: QuickFinderItem[] = [
    ...WORKSPACE_QUICK_ITEMS,
    {
      id: "doc-1",
      label: "Invoice — Synthetic Buyer Ltd",
      description: "Saved document · Version 2",
      href: "/workspace/documents/doc-1",
      group: "Your documents",
      keywords: "invoice synthetic buyer",
    },
  ];

  const invoiceHits = filterQuickFinderItems(items, "invoice");
  assert.equal(invoiceHits[0]?.id, "doc-1");
  assert.ok(invoiceHits.some((item) => item.id === "ws-new-doc"));

  const themeHits = filterQuickFinderItems(WORKSPACE_QUICK_ITEMS, "dark theme");
  assert.equal(themeHits[0]?.id, "ws-account");

  assert.equal(filterQuickFinderItems(PUBLIC_QUICK_ITEMS, "zzzz-no-match").length, 0);
});

test("PUBLIC_QUICK_ITEMS and WORKSPACE_QUICK_ITEMS return full lists on empty query", () => {
  assert.equal(filterQuickFinderItems(PUBLIC_QUICK_ITEMS, "   ").length, PUBLIC_QUICK_ITEMS.length);
  assert.equal(filterQuickFinderItems(WORKSPACE_QUICK_ITEMS, "").length, WORKSPACE_QUICK_ITEMS.length);
});

// WRK-001 and WRK-006: every quick-jump destination is a page the site has, one the server renders or
// a route of the browser app. "Support requests" once pointed at an address with neither, and opened
// the page the site does not have.
test("every quick-jump destination is a page the site has", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(routes.length > 10, "the app's routes are read");
  const reaches = (route: string, href: string) =>
    new RegExp(`^${route.replace(/:[^/]+/g, "[^/]+")}$`).test(href.split(/[?#]/)[0]!);
  for (const item of [...PUBLIC_QUICK_ITEMS, ...WORKSPACE_QUICK_ITEMS])
    assert.ok(
      isServerPage(item.href) || routes.some((route) => reaches(route, item.href)),
      `${item.id}: ${item.href}`,
    );
  // The workspace's support requests are one of them.
  assert.ok(routes.includes("/workspace/support"));
});
