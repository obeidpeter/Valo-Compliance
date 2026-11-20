import test from "node:test";
import assert from "node:assert/strict";
import { catalogueParams, libraryFilters, libraryHref } from "./library-filters";

test("the library reads its filters from the address, with anything unknown read as its default", () => {
  assert.deepEqual(libraryFilters(new URLSearchParams("")), {
    q: "",
    type: "all",
    industry: "",
    page: 1,
    category: "",
    access: "all",
    sort: "relevance",
  });
  const odd = libraryFilters(
    new URLSearchParams("type=secret&page=-2&access=paid&sort=random&q=invoice&industry=x&category=People"),
  );
  assert.deepEqual(odd, {
    q: "invoice",
    type: "all",
    industry: "x",
    page: 1,
    category: "People",
    access: "all",
    sort: "relevance",
  });
  assert.equal(libraryFilters(new URLSearchParams("page=3")).page, 3);
  assert.equal(libraryFilters(new URLSearchParams("page=2.5")).page, 1);
});

test("the library asks the catalogue for its filters, and links to a filter change from the first page without defaults", () => {
  const filters = libraryFilters(new URLSearchParams("q=invoice&type=template&page=4&access=free"));
  assert.deepEqual(catalogueParams(filters), {
    type: "template",
    page: 4,
    access: "free",
    sort: "relevance",
    q: "invoice",
  });
  assert.equal(
    libraryHref(filters, { sort: "name" }),
    "/library?q=invoice&type=template&access=free&sort=name",
  );
  assert.equal(libraryHref(filters, { page: 5 }), "/library?q=invoice&type=template&access=free&page=5");
  assert.equal(libraryHref(filters, { type: "all", access: "all", q: "" }), "/library");
});
