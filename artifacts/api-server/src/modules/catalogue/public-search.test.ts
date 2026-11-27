import assert from "node:assert/strict";
import test, { before } from "node:test";
import { paginateReleasedItems, type CatalogueQuery, type ReleasedLibraryItem } from "./valo-catalogue";
import { manualCatalogue } from "./manual-presentation";
import { directorySearchItems } from "./valo-released-content";
import { retainedDrafts, retainedItemId } from "../manual-library/retained";
import { RETAINED_ENTRY_DETAILS } from "../manual-library/retained-entry-details";

/**
 * WEB-003: "Search approved public templates, guidance, industries, articles and service categories,
 * with type and industry filters." Its acceptance asks that "a curated 50-query relevance test meets
 * its agreed pass threshold" (docs/architecture/public-search.md).
 *
 * The list searched here is the library's own, as it would stand were every draft kept in the
 * repository released: each draft as the staff library lists a released entry, then the industry
 * pages and the service categories. Nothing here is released, and no row is written.
 *
 * The searches, and the item each should find, are the builder's. The owner has agreed neither them
 * nor a pass threshold.
 */
let library: ReleasedLibraryItem[];
before(async () => {
  // The drafts are read only in development, as the staff library is used only there.
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const drafts = await retainedDrafts();
    library = [
      ...drafts.map((draft) =>
        manualCatalogue({
          id: draft.retainedId,
          slug: "manual-" + retainedItemId(draft.retainedId),
          title: draft.title,
          kind: draft.kind,
          industry: draft.industry,
          // The public list reads the first 600 characters of an entry's text.
          body: draft.body.slice(0, 600),
          purpose: RETAINED_ENTRY_DETAILS[draft.retainedId]?.purpose ?? null,
          sourceCheckedAt: null,
          publishedAt: new Date(Date.UTC(2026, 10, 1)),
        }),
      ),
      ...directorySearchItems(),
    ];
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

/** The first three results for a search, with the list in the order given and in the reverse order:
 * equal scores keep the list's order, and the order entries were released in is not the search's to rely on. */
const firstThree = (q: string) =>
  [library, [...library].reverse()].map((list) =>
    paginateReleasedItems(list, { q })
      .items.slice(0, 3)
      .map((item) => item.id),
  );
/** The searches of a set that do not find their item in the first three results, in either order. */
const missed = (searches: readonly (readonly [string, string])[]) =>
  searches.filter(([q, id]) => !firstThree(q).every((ids) => ids.includes(id))).map(([q]) => q);
const kind = (id: string) =>
  id.startsWith("TPL-")
    ? "template"
    : id.startsWith("GUD-")
      ? "guidance"
      : id.startsWith("industry:")
        ? "industry"
        : id.startsWith("service:")
          ? "service"
          : "article";
const byKind = (searches: readonly (readonly [string, string])[]) =>
  Object.fromEntries(
    ["template", "guidance", "article", "industry", "service"].map((type) => [
      type,
      searches.filter(([, id]) => kind(id) === type).length,
    ]),
  );
const spread = { template: 14, guidance: 12, article: 10, industry: 8, service: 6 };

// The curated set. The search was built against it: before, 29 of the 50 found their item.
const curated: [string, string][] = [
  ["invoice template", "TPL-01"],
  ["receipt", "TPL-03"],
  ["employment contract", "TPL-16"],
  ["NDA", "TPL-15"],
  ["offer letter", "TPL-17"],
  ["staff handbook", "TPL-26"],
  ["privacy policy", "TPL-29"],
  ["purchase orders", "TPL-04"],
  ["waybill", "TPL-05"],
  ["minutes of meeting", "TPL-08"],
  ["terms and conditions", "TPL-30"],
  ["contractor agreement", "TPL-21"],
  ["disciplinary", "TPL-28"],
  ["payment reminder", "TPL-12"],
  ["annual return for business name", "GUD-05"],
  ["company annual returns", "GUD-06"],
  ["TIN", "GUD-08"],
  ["company income tax", "GUD-09"],
  ["how long to keep tax records", "GUD-10"],
  ["consent", "GUD-12"],
  ["sending customer data abroad", "GUD-15"],
  ["no refund", "GUD-17"],
  ["maternity leave", "GUD-30"],
  ["annual leave", "GUD-29"],
  ["salary deductions", "GUD-28"],
  ["food advert", "GUD-26"],
  ["unpaid invoices", "GUIDE-C03"],
  ["how to write a quotation", "GUIDE-C02"],
  ["handover", "GUIDE-C11"],
  ["document versions", "GUIDE-C10"],
  ["meeting notes", "GUIDE-C07"],
  ["organise records", "GUIDE-C12"],
  ["expense claims", "GUIDE-C05"],
  ["restaurant where to start", "IND-C03"],
  ["retail five practical steps", "PACK-C01"],
  ["operating procedure", "GUIDE-C09"],
  ["restaurant", "industry:restaurants-hospitality"],
  ["hotel", "industry:restaurants-hospitality"],
  ["farming", "industry:agriculture"],
  ["shop", "industry:retail-wholesale"],
  ["school", "industry:education"],
  ["software", "industry:technology-software"],
  ["transport", "industry:logistics-transport"],
  ["real estate", "industry:real-estate"],
  ["register my business", "service:registration"],
  ["accountant", "service:accounting"],
  ["lawyer", "service:legal"],
  ["tax", "service:tax"],
  ["data protection", "service:privacy"],
  ["permit", "service:sector_approval"],
];
// Two further sets, each written after the search was last changed and first run before anything was
// changed for it. On those first runs they found 41 and 29 of their 50 (the note has both runs).
const second: [string, string][] = [
  ["quotation template", "TPL-02"],
  ["delivery note", "TPL-05"],
  ["stock register", "TPL-07"],
  ["customer complaints form", "TPL-09"],
  ["leave application", "TPL-10"],
  ["onboarding new staff", "TPL-11"],
  ["service contract", "TPL-13"],
  ["consultant agreement", "TPL-14"],
  ["job offer", "TPL-17"],
  ["supplier contract", "TPL-18"],
  ["partnership deed", "TPL-20"],
  ["board resolutions", "TPL-25"],
  ["data retention", "TPL-32"],
  ["health and safety", "TPL-33"],
  ["business name certificate", "GUD-03"],
  ["change business name details", "GUD-04"],
  ["accounting records", "GUD-07"],
  ["tax return", "GUD-09"],
  ["collecting customer information", "GUD-11"],
  ["data subject request", "GUD-13"],
  ["price display", "GUD-16"],
  ["refund policy", "GUD-17"],
  ["unfair contract terms", "GUD-18"],
  ["NAFDAC registration", "GUD-21"],
  ["expired stock disposal", "GUD-25"],
  ["employment particulars", "GUD-27"],
  ["inventory register guide", "GUIDE-C04"],
  ["purchase order and delivery", "GUIDE-C06"],
  ["customer complaint resolution", "GUIDE-C08"],
  ["write a procedure", "GUIDE-C09"],
  ["version control", "GUIDE-C10"],
  ["business records", "GUIDE-C12"],
  ["construction where to start", "IND-C07"],
  ["starting a salon", "IND-C11"],
  ["professional services practical steps", "PACK-C06"],
  ["packaged food steps", "PACK-C02"],
  ["supermarket", "industry:retail-wholesale"],
  ["poultry farm", "industry:agriculture"],
  ["pharmacy", "industry:healthcare"],
  ["tailoring", "industry:fashion-textiles"],
  ["logistics", "industry:logistics-transport"],
  ["construction company", "industry:construction"],
  ["online store", "industry:e-commerce"],
  ["solar", "industry:energy"],
  ["company registration", "service:registration"],
  ["bookkeeping", "service:accounting"],
  ["legal documents", "service:legal"],
  ["employment", "service:employment"],
  ["privacy", "service:privacy"],
  ["licence", "service:sector_approval"],
];
const third: [string, string][] = [
  ["receipt template", "TPL-03"],
  ["LPO", "TPL-04"],
  ["expense form", "TPL-06"],
  ["complaint form", "TPL-09"],
  ["reminder letter for payment", "TPL-12"],
  ["confidentiality agreement", "TPL-15"],
  ["employment letter", "TPL-16"],
  ["sale of goods agreement", "TPL-19"],
  ["freelancer contract", "TPL-21"],
  ["proposal", "TPL-22"],
  ["scope of work", "TPL-23"],
  ["company handbook", "TPL-26"],
  ["website terms", "TPL-30"],
  ["accident report", "TPL-34"],
  ["trading name", "GUD-01"],
  ["company or business name", "GUD-02"],
  ["update business name", "GUD-04"],
  ["annual returns", "GUD-06"],
  ["Tax ID", "GUD-08"],
  ["keeping tax records", "GUD-10"],
  ["privacy notice for customers", "GUD-11"],
  ["data access request", "GUD-13"],
  ["supplier data agreement", "GUD-14"],
  ["customer receipts", "GUD-16"],
  ["cancellations", "GUD-18"],
  ["food inspection", "GUD-20"],
  ["invoice guide", "GUIDE-C01"],
  ["quotation guide", "GUIDE-C02"],
  ["chasing payment", "GUIDE-C03"],
  ["stock records", "GUIDE-C04"],
  ["purchase orders and invoices", "GUIDE-C06"],
  ["minutes and actions", "GUIDE-C07"],
  ["handing over work", "GUIDE-C11"],
  ["filing documents", "GUIDE-C12"],
  ["logistics where to start", "IND-C06"],
  ["beauty practical steps", "PACK-C05"],
  ["wholesale", "industry:retail-wholesale"],
  ["bakery", "industry:packaged-food-manufacturing"],
  ["hospital", "industry:healthcare"],
  ["boutique", "industry:fashion-textiles"],
  ["haulage", "industry:logistics-transport"],
  ["builder", "industry:construction"],
  ["tech startup", "industry:technology-software"],
  ["fintech", "industry:financial-services"],
  ["CAC registration", "service:registration"],
  ["tax consultant", "service:tax"],
  ["audit", "service:accounting"],
  ["hiring staff", "service:employment"],
  ["NDPR", "service:privacy"],
  ["NAFDAC permit", "service:sector_approval"],
];

test("the list a search is judged on is the library's own, were every draft kept in the repository released: 40 templates, 30 guides to the rules, 38 articles, 20 industry pages and 7 service categories", () => {
  const count = (type: string) => library.filter((item) => item.type === type).length;
  assert.deepEqual(
    Object.fromEntries(["template", "guidance", "article", "industry", "service"].map((t) => [t, count(t)])),
    { template: 40, guidance: 30, article: 38, industry: 20, service: 7 },
  );
  assert.equal(library.length, 135);
  assert.equal(new Set(library.map((item) => item.id)).size, 135);
  // Every expected item of every search is in the list, so that no search can only miss.
  for (const [q, id] of [...curated, ...second, ...third])
    assert.ok(
      library.some((item) => item.id === id),
      `${q}: ${id}`,
    );
  // A search reads what the list shows of an item: its title, and a description of 260 characters at most.
  for (const item of library) assert.ok(item.summary.length <= 260, item.id);
  // The categories it lists. The library's category filter offers each
  // (artifacts/valo/src/lib/library-filters.ts).
  assert.deepEqual([...new Set(library.flatMap((item) => item.category ?? []))].sort(), [
    "Agreements and sales",
    "Business management",
    "Finance and operations",
    "Industry directory",
    "Industry introductions",
    "Industry packs",
    "People",
    "Practical business guides",
    "Privacy and data",
    "Regulatory guidance",
    "Service enquiries",
  ]);
});

test("50 curated searches across templates, guides to the rules, articles, industry pages and service categories each find the expected item in the first three results, whichever order the list is in", () => {
  assert.equal(curated.length, 50);
  assert.equal(new Set(curated.map(([q]) => q)).size, 50);
  assert.deepEqual(byKind(curated), spread);
  assert.deepEqual(missed(curated), []);
});

test("of two further sets of 50 searches across the five kinds, 47 and 42 find their item in the first three results, and the eleven that do not are the ones named", () => {
  for (const set of [second, third]) {
    assert.equal(set.length, 50);
    assert.deepEqual(byKind(set), spread);
  }
  assert.equal(new Set([...curated, ...second, ...third].map(([q]) => q.toLowerCase())).size, 150);
  // Each has a word that no title or description of its item has, and an item must have every word.
  assert.deepEqual(missed(second), ["data subject request", "refund policy", "unfair contract terms"]);
  assert.deepEqual(missed(third), [
    "employment letter",
    "privacy notice for customers",
    "data access request",
    "customer receipts",
    "minutes and actions",
    "filing documents",
    "tax consultant",
    "NAFDAC permit",
  ]);
});

test("the type and industry filters narrow a search over all five kinds, alone and together", () => {
  const found = (query: CatalogueQuery) => {
    const all: ReleasedLibraryItem[] = [];
    for (let page = 1; ; page++) {
      const result = paginateReleasedItems(library, { ...query, page });
      all.push(...result.items);
      if (all.length >= result.total) return all;
    }
  };
  // Each type alone lists every item of its kind and no other.
  for (const [type, count] of Object.entries({
    template: 40,
    guidance: 30,
    article: 38,
    industry: 20,
    service: 7,
  })) {
    const items = found({ type });
    assert.equal(items.length, count, type);
    assert.ok(
      items.every((item) => item.type === type),
      type,
    );
  }
  assert.equal(found({ type: "all" }).length, 135);
  // One search under each type: "food" is in a template's, eight guides', two articles' and one
  // industry page's own words, and in no service category's.
  const ids = (query: CatalogueQuery) =>
    found(query)
      .map((item) => item.id)
      .sort();
  assert.deepEqual(ids({ q: "food", type: "industry" }), ["industry:packaged-food-manufacturing"]);
  assert.deepEqual(ids({ q: "food", type: "article" }), ["IND-C02", "PACK-C02"]);
  assert.deepEqual(ids({ q: "food", type: "service" }), []);
  assert.ok(ids({ q: "food", type: "template" }).includes("TPL-37"));
  assert.ok(found({ q: "food", type: "template" }).every((item) => item.type === "template"));
  assert.deepEqual(ids({ q: "food", type: "guidance" }), [
    "GUD-19",
    "GUD-20",
    "GUD-21",
    "GUD-22",
    "GUD-23",
    "GUD-24",
    "GUD-26",
  ]);
  // An industry alone lists what is filed under it and what is for every industry: here its page, its
  // introduction and its pack, with the 89 items that are for all industries.
  const hospitality = found({ industry: "restaurants-hospitality" });
  assert.deepEqual(
    hospitality
      .filter((item) => item.industry !== "All industries")
      .map((item) => item.id)
      .sort(),
    ["IND-C03", "PACK-C03", "industry:restaurants-hospitality"],
  );
  assert.equal(hospitality.length, 3 + library.filter((item) => item.industry === "All industries").length);
  // The two together, and with a search: an everyday word finds the industry's own page and articles.
  assert.deepEqual(ids({ industry: "restaurants-hospitality", type: "industry" }), [
    "industry:restaurants-hospitality",
  ]);
  assert.deepEqual(ids({ q: "hotel", industry: "restaurants-hospitality", type: "article" }), [
    "IND-C03",
    "PACK-C03",
  ]);
  assert.deepEqual(ids({ q: "hotel", industry: "agriculture" }), []);
  assert.deepEqual(ids({ q: "hotel", type: "template" }), []);
  // An industry that no item names, and a type the list does not have, find nothing.
  assert.deepEqual(ids({ industry: "not-an-industry", type: "industry" }), []);
  assert.deepEqual(ids({ type: "not-a-type" }), []);
});

// The rules a search reads by, each on a few plain items.
const entry = (id: string, title: string, summary = "", more: Partial<ReleasedLibraryItem> = {}) => ({
  id,
  slug: id,
  title,
  type: "article",
  industry: "All industries",
  summary,
  ...more,
});
const order = (items: ReleasedLibraryItem[], q: string) =>
  paginateReleasedItems(items, { q }).items.map((item) => item.id);

test("a search reads a plural as its singular either way, a possessive as the word, and a word still being typed as the start of one", () => {
  const items = [
    entry("one", "Invoice", "What a customer owes."),
    entry("many", "Workplace policies", "What each company's staff may do."),
    entry("other", "Receipt"),
  ];
  assert.deepEqual(order(items, "invoices"), ["one"]);
  assert.deepEqual(order(items, "policy"), ["many"]);
  assert.deepEqual(order(items, "customers"), ["one"]);
  assert.deepEqual(order(items, "companies"), ["many"]);
  assert.deepEqual(order(items, "company"), ["many"]);
  // A possessive's mark is no word of its own: nothing here begins with "s".
  const form = [entry("form", "Customer complaint form", "A record of it.")];
  assert.deepEqual(order(form, "customer's complaint"), ["form"]);
  assert.deepEqual(order(form, "customer\u2019s complaint"), ["form"]);
  assert.deepEqual(order(form, "customer s complaint"), []);
  // Each letter typed narrows the same result, with no letter at which it goes.
  for (const typed of ["p", "po", "pol", "poli", "polic", "polici", "policie", "policies"])
    assert.deepEqual(order(items, typed), ["many"], typed);
  for (const typed of ["inv", "invo", "invoic", "invoice"])
    assert.deepEqual(order(items, typed), ["one"], typed);
  // A word that only ends like a plural is left as it is.
  assert.deepEqual(order([entry("a", "Glass status"), entry("b", "Glas statu")], "glass status"), ["a"]);
});

test("the small words of a question are left out of a search that has other words, and searched for when it has none", () => {
  const items = [
    entry("guide", "Write a quotation that makes the offer clear"),
    entry("form", "Quotation"),
    entry("about", "How to do it", "A note on the way in."),
  ];
  // No item has "how", and the search still finds the two that have "write" and "quotation".
  assert.deepEqual(order(items, "how to write a quotation"), ["guide"]);
  assert.deepEqual(order(items, "what is a quotation"), ["form", "guide"]);
  assert.deepEqual(order(items, "how long should I keep a quotation for"), []);
  assert.deepEqual(order(items, "how much is the quotation"), ["form", "guide"]);
  // A search of small words alone is a search for them.
  assert.deepEqual(order(items, "how to"), ["about"]);
  assert.deepEqual(order(items, "the"), ["guide", "about"]);
  // "No" is not one of them: it changes what is asked.
  assert.deepEqual(order([entry("a", "Refunds"), entry("b", "No refunds")], "no refund"), ["b"]);
});

test("two words for the same thing find each other's items, count as the title's own word, and make a title the search itself", () => {
  const items = [
    entry("handbook", "Employee handbook", "Explain your workplace to employees."),
    entry("checklist", "Staff onboarding checklist"),
    entry("note", "Delivery note"),
    entry("guide", "Keep a delivery note with each order", "For staff who send goods."),
    entry("nda", "Non-disclosure agreement"),
    entry("contract", "Employment contract"),
  ];
  assert.deepEqual(order(items, "staff handbook"), ["handbook"]);
  assert.deepEqual(order(items, "employee onboarding"), ["checklist"]);
  assert.deepEqual(order(items, "workers handbook"), ["handbook"]);
  // A word with more than one word for it, and the short name of a document.
  assert.deepEqual(order(items, "waybill"), ["note", "guide"]);
  assert.deepEqual(order(items, "NDA"), ["nda"]);
  assert.deepEqual(order(items, "employment agreement"), ["contract"]);
  // The title that is the search comes first, though the guide was released later and so listed first.
  assert.deepEqual(order([...items].reverse(), "waybill"), ["note", "guide"]);
  // A phrase written two ways.
  assert.deepEqual(order([entry("a", "Privacy notice"), entry("b", "Leave policy")], "privacy policy"), [
    "a",
  ]);
  assert.deepEqual(order([entry("a", "Hand over work"), entry("b", "Handover form")], "handover"), [
    "a",
    "b",
  ]);
});

test("an everyday word finds what the site files it under and ranks below the title's own word, and the site's word finds nothing more for it", () => {
  const items = [
    entry("page", "restaurants/hospitality", "Browse this industry.", { type: "industry" }),
    entry("start", "Restaurants/hospitality: where to start"),
    entry("form", "Hotel booking form"),
    entry("stay", "A guest's stay", "What a hotel records."),
    entry("farm", "Agriculture: where to start"),
  ];
  // The title that says "hotel" first, then the two filed under hospitality, then the description.
  assert.deepEqual(order(items, "hotel"), ["form", "page", "start", "stay"]);
  assert.deepEqual(order(items, "hotels"), ["form", "page", "start", "stay"]);
  // The site's own word finds only what has it.
  assert.deepEqual(order(items, "hospitality"), ["page", "start"]);
  assert.deepEqual(order(items, "farmers"), ["farm"]);
  assert.deepEqual(order(items, "agriculture"), ["farm"]);
  // With another word, the title that has the word itself still comes before the one filed under it,
  // though listed after it.
  const lists = [entry("filed", "Hospitality checklist"), entry("own", "Checklist for a hotel")];
  assert.deepEqual(order(lists, "hotel checklist"), ["own", "filed"]);
  // A word that is the start of another is that word first: "hospital" is filed under healthcare.
  const care = [...items, entry("care", "healthcare", "", { type: "industry" })];
  assert.deepEqual(order(care, "hospital"), ["care", "page", "start"]);
  assert.deepEqual(order(care, "hospitali"), ["page", "start"]);
});

test("a word that says only that the searcher is a business rules no item out, counts for the item that has it, and is searched for when it is the whole search", () => {
  const items = [
    entry("page", "construction", "Browse this industry.", { type: "industry" }),
    entry("names", "Prepare the annual return for a registered business name"),
    entry("returns", "Keep company annual returns separate from tax filings"),
  ];
  assert.deepEqual(order(items, "construction company"), ["page"]);
  assert.deepEqual(order(items, "construction business"), ["page"]);
  assert.deepEqual(order(items, "company annual returns"), ["returns", "names"]);
  assert.deepEqual(order(items, "business name annual return"), ["names"]);
  assert.deepEqual(order(items, "company"), ["returns"]);
  assert.deepEqual(order(items, "my business"), ["names"]);
  // It counts for the title that has it, though that title is listed after one that has not.
  const both = [entry("plain", "Annual returns"), entry("for", "Annual returns of a company")];
  assert.deepEqual(order(both, "company annual returns"), ["for", "plain"]);
  // Every other word must be found.
  assert.deepEqual(order(items, "construction permit"), []);
});

test("a word in -ing or -ed finds the word it comes from, when that leaves four letters or more", () => {
  const items = [
    entry("start", "Beauty: where to start"),
    entry("name", "Register a business name"),
    entry("ring", "The ring road", "A stretch of it."),
  ];
  assert.deepEqual(order(items, "starting"), ["start"]);
  assert.deepEqual(order(items, "registered"), ["name"]);
  assert.deepEqual(order(items, "registering"), ["name"]);
  // "String" is not read as "str", nor "bring" as "br".
  assert.deepEqual(order(items, "string"), []);
  assert.deepEqual(order(items, "bring"), []);
});

test("a title that is the search comes first, then one that begins with it, then one that has its words together, then one that has them apart", () => {
  const items = [
    entry("apart", "Leave for the annual stocktake"),
    entry("inside", "Plan annual leave using the applicable terms"),
    entry("begins", "Annual leave planner"),
    entry("whole", "Annual leave"),
    entry("described", "Time away", "How annual leave is counted."),
  ];
  assert.deepEqual(order(items, "annual leave"), ["whole", "begins", "inside", "apart", "described"]);
  assert.deepEqual(order([...items].reverse(), "annual leave"), [
    "whole",
    "begins",
    "inside",
    "apart",
    "described",
  ]);
  // The plural and the small words do not change it.
  assert.deepEqual(order(items, "the annual leaves")[0], "whole");
});

test("a search reads an item's kind and its industry, and never the words that say it is for all industries", () => {
  const items = [
    entry("template", "Invoice", "Ask a customer to pay.", { type: "template", category: "Finance" }),
    entry("guide", "Prepare an invoice", "From facts you can check."),
    entry("pack", "Five steps", "For a shop.", { industry: "retail-wholesale" }),
  ];
  assert.deepEqual(order(items, "invoice template"), ["template"]);
  assert.deepEqual(order(items, "invoice sample"), ["template"]);
  assert.deepEqual(order(items, "invoice article"), ["guide"]);
  assert.deepEqual(order(items, "finance"), ["template"]);
  assert.deepEqual(order(items, "wholesale"), ["pack"]);
  // "All industries" names no industry: a search for "industries" does not find every general item.
  assert.deepEqual(order(items, "industries"), []);
  assert.deepEqual(order(items, "all"), []);
});

test("an item is found only when it has every word that says what is wanted, and a search of marks alone lists everything", () => {
  const items = [entry("a", "Tax records", "How long to keep them."), entry("b", "Tax return")];
  assert.deepEqual(order(items, "tax"), ["a", "b"]);
  assert.deepEqual(order(items, "tax records"), ["a"]);
  assert.deepEqual(order(items, "tax records abroad"), []);
  assert.deepEqual(order(items, "zebra"), []);
  assert.deepEqual(order(items, "?!"), ["a", "b"]);
  assert.deepEqual(order(items, "   "), ["a", "b"]);
});
