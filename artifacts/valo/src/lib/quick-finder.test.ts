import assert from "node:assert/strict";
import { test } from "node:test";
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
