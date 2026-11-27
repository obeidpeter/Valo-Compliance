import assert from "node:assert/strict";
import { test } from "node:test";
import { clippedSearch, filteredHref, pickedFilter, typedSearch } from "./page-filters";

// WEB-002: "search/filter URLs must be shareable."
test("a page's search and filters make one address for each view, and the plain page keeps its plain address", () => {
  assert.equal(filteredHref("/resources", { q: "", industry: "" }), "/resources");
  assert.equal(filteredHref("/resources", { q: "tax return", industry: "" }), "/resources?q=tax+return");
  assert.equal(
    filteredHref("/resources", { q: "", industry: "food-processing" }),
    "/resources?industry=food-processing",
  );
  assert.equal(
    filteredHref("/resources", { q: "tax return", industry: "general" }),
    "/resources?q=tax+return&industry=general",
  );
  assert.equal(
    filteredHref("/industries", { q: "  fashion  " }),
    "/industries?q=fashion",
    "spaces around a search are not part of it",
  );
  assert.equal(filteredHref("/help", { q: "   " }), "/help", "a search of spaces is no search");
  // What a visitor types is carried as text, whatever it holds.
  assert.equal(
    filteredHref("/help", { q: 'refund & "receipt" <b>?#' }),
    "/help?q=refund+%26+%22receipt%22+%3Cb%3E%3F%23",
  );
});

test("an address gives back the search and the filter it was made with, and nothing longer than a search may be", () => {
  const view = { q: "tax return", industry: "food-processing" };
  const sp = new URLSearchParams(filteredHref("/resources", view).split("?")[1]);
  assert.deepEqual({ q: typedSearch(sp), industry: pickedFilter(sp, "industry") }, view);
  const odd = new URLSearchParams(filteredHref("/help", { q: 'refund & "receipt" <b>?#' }).split("?")[1]);
  assert.equal(typedSearch(odd), 'refund & "receipt" <b>?#');
  // An address someone else wrote: no search, a padded one, a very long one, a filter given twice.
  assert.equal(typedSearch(new URLSearchParams("")), "");
  assert.equal(pickedFilter(new URLSearchParams(""), "industry"), "");
  assert.equal(typedSearch(new URLSearchParams("q=%20%20vat%20")), "vat");
  assert.equal(typedSearch(new URLSearchParams("q=" + "a".repeat(500))).length, 120);
  assert.equal(clippedSearch("a".repeat(500)).length, 120);
  assert.equal(pickedFilter(new URLSearchParams("industry=" + "b".repeat(500)), "industry").length, 80);
  assert.equal(pickedFilter(new URLSearchParams("industry=retail&industry=fashion"), "industry"), "retail");
  assert.equal(filteredHref("/help", { q: "a".repeat(500) }), "/help?q=" + "a".repeat(120));
});
