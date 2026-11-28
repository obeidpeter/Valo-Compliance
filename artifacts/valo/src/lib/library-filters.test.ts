import test from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_CATEGORIES,
  catalogueParams,
  industryLabel,
  industryName,
  libraryFilters,
  libraryHref,
  typeName,
} from "./library-filters";

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
  // The search is read as the box shows it and the API reads it: without the spaces around it, and
  // no longer than a search may be. The page so never has to correct its own address.
  assert.equal(libraryFilters(new URLSearchParams("q=%20invoice%20")).q, "invoice");
  assert.equal(libraryFilters(new URLSearchParams("q=" + "a".repeat(500))).q, "a".repeat(120));
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

test("a result names its kind and its industries in words, never by their codes", () => {
  assert.deepEqual(["template", "guidance", "article", "industry", "service"].map(typeName), [
    "Template",
    "Guidance",
    "Article",
    "Industry page",
    "Service enquiry",
  ]);
  const names = new Map([
    ["retail-wholesale", "Retail and wholesale"],
    ["food-services", "Food and hospitality"],
    ["professional-services", "Professional services"],
  ]);
  assert.equal(industryLabel("All industries", names), "All industries");
  assert.equal(industryLabel("retail-wholesale", names), "Retail and wholesale");
  assert.equal(
    industryLabel("retail-wholesale,food-services", names),
    "Retail and wholesale · Food and hospitality",
  );
  assert.equal(
    industryLabel("retail-wholesale,food-services,professional-services", names),
    "Retail and wholesale and 2 more",
  );
  // A code the list of industries does not have is never shown as it is.
  assert.equal(industryLabel("retail-wholesale,unlisted-code", names), "Retail and wholesale");
  assert.equal(industryLabel("unlisted-code", names), null);
  assert.equal(industryLabel("retail-wholesale", new Map()), null);
  // The list of industries writes its names in lower case; a page starts each with a capital.
  assert.equal(industryName("retail/wholesale"), "Retail/wholesale");
  assert.equal(industryName("packaged-food manufacturing"), "Packaged-food manufacturing");
  assert.equal(
    industryLabel(
      "a,b",
      new Map([
        ["a", "retail/wholesale"],
        ["b", "agriculture"],
      ]),
    ),
    "Retail/wholesale · Agriculture",
  );
});

test("library categories cover every reviewed, manual and directory category without duplicates", () => {
  assert.equal(new Set(LIBRARY_CATEGORIES).size, LIBRARY_CATEGORIES.length);
  for (const required of [
    "Finance and operations",
    "People",
    "Agreements and sales",
    "Privacy and data",
    "Business management",
    "Business templates",
    "Business guidance",
    "Regulatory guidance",
    "Practical business guides",
    "Industry guidance",
    "Industry introductions",
    "Industry packs",
    "Location guidance",
    "Industry directory",
    "Service enquiries",
  ]) {
    assert.ok((LIBRARY_CATEGORIES as readonly string[]).includes(required), required);
  }
});
