import assert from "node:assert/strict";
import test from "node:test";
import { paginateReleasedItems } from "./valo-catalogue";
import { manualCatalogue, manualResource, manualTemplate } from "./manual-presentation";
import { releasedDocumentText, sampleFieldsPreview, templatePreview } from "./template-preview";
import { escapeLikePattern } from "../manual-library";
import { verifiedRightsApplicability } from "../publication/rights-applicability";
test("synthetic already-eligible catalogue metadata produces nonzero counts, filters and pagination", () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: `synthetic-${i}`,
    slug: `synthetic-${i}`,
    title: `Inventory${i}`,
    type: "template",
    industry: "All industries",
    summary: "Synthetic metadata adapter case, not published business content",
  }));
  assert.equal(paginateReleasedItems(rows).total, 23);
  assert.equal(paginateReleasedItems(rows, { page: 2 }).items.length, 3);
  assert.equal(paginateReleasedItems(rows, { q: "Inventory22" }).total, 1);
  assert.equal(paginateReleasedItems(rows, { type: "guidance" }).total, 0);
  assert.equal(
    paginateReleasedItems([]).total,
    0,
    "withdrawn/held versions must not be passed as eligible inputs",
  );
});
test("rights applicability is evidence-dependent, not an unconditional development hold", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const fixture = {
    version: "synthetic-only",
    status: "verified",
    accountPlan: "synthetic-account-contract",
    accountTerms: "Synthetic contract fixture, not actual terms evidence",
    integration: "replit_managed_openai",
    provider: "openai",
    commercialUseScope: "blank_operational_forms_internal_business_licence",
    checkedAt: now.toISOString(),
    limitations: [],
    evidence: ["account", "integration", "provider"].map((kind) => ({
      kind,
      url: "https://synthetic.example/terms",
      hash: "a".repeat(64),
      locator: "Synthetic fixture",
      quote: "Synthetic quote, not business evidence",
      applicabilityEvidence: "Synthetic mapping",
    })),
  };
  assert.ok(
    verifiedRightsApplicability(fixture, now),
    "Synthetic engineering predicate only; no real clearance",
  );
  assert.equal(verifiedRightsApplicability({ ...fixture, status: "unverified" }, now), false);
  assert.equal(verifiedRightsApplicability({ ...fixture, accountTerms: null }, now), false);
  assert.equal(verifiedRightsApplicability({ ...fixture, evidence: fixture.evidence.slice(1) }, now), false);
  assert.equal(verifiedRightsApplicability({ ...fixture, checkedAt: "2025-01-01T00:00:00Z" }, now), false);
});

// docs/architecture/results.md, slice 1: a result finds the documents its rules relate by number.
test("a staff library template is listed by the number of the registered template whose title it has, and no other entry has a number", () => {
  const publishedAt = new Date("2026-11-25T10:00:00Z");
  const row = (
    kind: "template" | "premium_template" | "practical_guide" | "regulatory_article",
    title: string,
  ) =>
    manualCatalogue({
      id: "00000000-0000-4000-8000-000000000011",
      slug: "manual-00000000-0000-4000-8000-000000000012",
      industry: null,
      body: "Synthetic manual body text for testing.",
      purpose: null,
      sourceCheckedAt: null,
      publishedAt,
      kind,
      title,
    });
  // Filed as a registered template by its title, as the staff library's access check finds it, in
  // any letter case: listed by that template's number and in its category.
  assert.equal(row("template", "Invoice").templateNumber, "TPL-01");
  const notice = row("premium_template", "privacy NOTICE");
  assert.equal(notice.templateNumber, "TPL-29");
  assert.equal(notice.category, "Privacy and data");
  // A template with any other title, and anything that is not a template, has none.
  assert.equal(row("premium_template", "Synthetic privacy notice").templateNumber, undefined);
  assert.equal(row("practical_guide", "Invoice").templateNumber, undefined);
  assert.equal(row("regulatory_article", "Privacy notice").templateNumber, undefined);
});

test("manualCatalogue maps regulatory articles to guidance, uses sourceCheckedAt, and maps baseline template categories", () => {
  const publishedAt = new Date("2026-11-22T10:00:00Z");
  const sourceCheckedAt = new Date("2026-11-22T15:30:00Z");
  const base = {
    id: "00000000-0000-4000-8000-000000000001",
    itemId: "00000000-0000-4000-8000-000000000002",
    version: 1,
    slug: "manual-00000000-0000-4000-8000-000000000002",
    industry: null as string | null,
    body: "Synthetic manual body text for testing.",
    digest: "a".repeat(64),
    fileFormat: null as "docx" | "pdf" | null,
    state: "published" as const,
    createdAt: publishedAt,
    publishedAt,
    closedAt: null,
    regulatorySources: null,
    sourceCheckedAt: null as Date | null,
    purpose: null as string | null,
    needs: null as string | null,
    limits: null as string | null,
    relatedItems: null as string[] | null,
    aiDrafted: null as boolean | null,
  };
  const regulatory = manualCatalogue({
    ...base,
    kind: "regulatory_article",
    title: "Business name registration",
    sourceCheckedAt,
  });
  assert.equal(regulatory.type, "guidance");
  assert.equal(regulatory.category, "Regulatory guidance");
  assert.equal(regulatory.reviewedAt, sourceCheckedAt.toISOString());
  assert.equal(regulatory.href, "/resources/" + base.slug);

  const baselineTemplate = manualCatalogue({
    ...base,
    kind: "template",
    title: "Invoice",
  });
  assert.equal(baselineTemplate.type, "template");
  assert.equal(baselineTemplate.category, "Finance and operations");
  assert.equal(baselineTemplate.access, "free");

  const customPremium = manualCatalogue({
    ...base,
    kind: "premium_template",
    title: "Custom sector checklist",
  });
  assert.equal(customPremium.type, "template");
  assert.equal(customPremium.category, "Business templates");
  assert.equal(customPremium.access, "premium");

  const guide = manualCatalogue({
    ...base,
    kind: "practical_guide",
    title: "Practical bookkeeping",
  });
  assert.equal(guide.type, "article");
  assert.equal(guide.category, "Practical business guides");

  const intro = manualCatalogue({
    ...base,
    kind: "industry_introduction",
    industry: "retail",
    title: "Retail overview",
  });
  assert.equal(intro.type, "article");
  assert.equal(intro.category, "Industry introductions");

  const pack = manualCatalogue({
    ...base,
    kind: "industry_pack",
    industry: "retail-wholesale",
    title: "Retail/wholesale: five practical steps",
  });
  assert.equal(pack.type, "article");
  assert.equal(pack.category, "Industry packs");
  assert.equal(pack.industry, "retail-wholesale");
  assert.equal(pack.href, "/resources/" + base.slug);
  const packPage = manualResource({
    ...base,
    kind: "industry_pack",
    industry: "retail-wholesale",
    title: "Retail/wholesale: five practical steps",
  });
  assert.equal(packPage.kind, "industry_pack");
  assert.deepEqual(packPage.industrySlugs, ["retail-wholesale"]);
  assert.equal(packPage.disclosure, "Published by the Valo editorial team.");

  const filtered = paginateReleasedItems([regulatory, baselineTemplate, customPremium, guide, intro, pack], {
    type: "guidance",
    category: "Regulatory guidance",
  });
  assert.deepEqual(
    filtered.items.map((item) => item.title),
    ["Business name registration"],
  );
});

test("escapeLikePattern escapes SQL wildcards and backslashes literally", () => {
  assert.equal(escapeLikePattern("100% tax_check\\draft"), "100\\% tax\\_check\\\\draft");
  assert.equal(escapeLikePattern("Invoice template"), "Invoice template");
});

// DOC-004: a free library template's page shows a preview, not its whole text, which is in its file.
test("a staff-library template's page previews the opening of its text in whole paragraphs, and not all of it", () => {
  const description = "A blank synthetic agreement template to complete with your own details.";
  assert.equal(templatePreview(description), description);
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) => `Synthetic paragraph ${i + 1}. ` + "Synthetic template words ".repeat(6).trim(),
  );
  const preview = templatePreview(paragraphs.join("\n\n"));
  assert.ok(preview.startsWith(paragraphs[0]! + "\n\n" + paragraphs[1]!), preview);
  assert.ok(!preview.includes(paragraphs[5]!), preview);
  assert.ok(preview.endsWith(" …") && preview.length <= 702, preview);
  // A first paragraph longer than the preview is cut at a word.
  const cut = templatePreview("word ".repeat(300).trim());
  assert.ok(cut.endsWith("word …") && cut.length <= 702, cut);
});

test("a reviewed template's page previews the opening of its own released text, a table's rows one to a line", () => {
  const text = releasedDocumentText({
    blocks: [
      { text: "Synthetic stock register", rows: [] },
      {
        text: "",
        rows: [
          ["Item", "Unit"],
          ["Synthetic item", "Box"],
        ],
      },
      { text: "   ", rows: [] },
      { text: "Synthetic closing line", rows: [] },
    ],
  });
  assert.equal(
    text,
    "Synthetic stock register\n\nItem | Unit\nSynthetic item | Box\n\nSynthetic closing line",
  );
  assert.equal(templatePreview(text), text);
});

test("a premium template's preview names only the sample fields its text marks, never its wording", () => {
  const text =
    "This synthetic agreement binds [Customer name] and [Provider name]. The [Customer name] pays within [ ] days.";
  assert.deepEqual(sampleFieldsPreview(text), [
    "SAMPLE FIELDS: Customer name; Provider name [your information]",
  ]);
  assert.ok(!sampleFieldsPreview(text).join(" ").includes("binds"));
  assert.deepEqual(sampleFieldsPreview("No fields at all."), [
    "SAMPLE FIELD: Business name [your information]",
  ]);
});

// DOC-003, EDP-008: a staff-library template's page says what it is for, what a customer needs, its
// limits, how it was written and checked, and links its related guides while they are released.
test("a staff-library template's page shows its released details, its statement and only its released related guides", () => {
  const publishedAt = new Date("2026-11-24T09:00:00Z");
  const row = (
    itemId: string,
    kind: "template" | "practical_guide" | "regulatory_article",
    title: string,
  ) => ({
    id: itemId.replace(/.$/, "9"),
    itemId,
    version: 1,
    slug: "manual-" + itemId,
    kind,
    industry: null,
    title,
    body: "Synthetic text of the item.",
    digest: "a".repeat(64),
    fileFormat: kind === "template" ? ("docx" as const) : null,
    state: "published" as const,
    createdAt: publishedAt,
    publishedAt,
    closedAt: null,
    regulatorySources: null,
    sourceCheckedAt: null,
    purpose: null as string | null,
    needs: null as string | null,
    limits: null as string | null,
    relatedItems: null as string[] | null,
    aiDrafted: null as boolean | null,
  });
  const guide = row("00000000-0000-4000-8000-0000000000a1", "practical_guide", "Synthetic guide");
  const article = row("00000000-0000-4000-8000-0000000000a2", "regulatory_article", "Synthetic article");
  const unreleased = "00000000-0000-4000-8000-0000000000a3";
  const template = {
    ...row("00000000-0000-4000-8000-0000000000b1", "template", "Synthetic register"),
    purpose: "Keep a synthetic record.",
    needs: "The first synthetic fact\nThe second synthetic fact",
    limits: "It does not prove anything about the synthetic record.",
    relatedItems: [guide.itemId, unreleased, article.itemId],
    aiDrafted: true,
  };
  const page = manualTemplate(template, [guide, article, template]);
  assert.equal(page.summary, "Keep a synthetic record.");
  assert.equal(page.purpose, "Keep a synthetic record.");
  assert.deepEqual(page.needs, ["The first synthetic fact", "The second synthetic fact"]);
  assert.equal(page.limitations, "It does not prove anything about the synthetic record.");
  assert.match(page.disclosure, /^Drafted with AI\. .*Valo ran no AI review of it/);
  assert.match(page.disclosure, /no Nigerian legal, tax or sector specialist reviewed it\.$/);
  // A related guide that is not released is left out; each one shown says what kind of guide it is.
  assert.deepEqual(page.relatedGuides, [
    { title: "Synthetic guide", href: "/resources/" + guide.slug, kind: "guide" },
    { title: "Synthetic article", href: "/resources/" + article.slug, kind: "guidance" },
  ]);
  assert.match(manualTemplate({ ...template, aiDrafted: false }).disclosure, /^Written without AI\./);
  assert.equal(manualCatalogue(template).summary, "Keep a synthetic record.");
  // A version released before the details existed shows none, and says only what is known.
  const older = manualTemplate(row("00000000-0000-4000-8000-0000000000c1", "template", "Synthetic older"));
  assert.equal(older.purpose, undefined);
  assert.equal(older.needs, undefined);
  assert.equal(older.relatedGuides, undefined);
  assert.equal(older.limitations, "");
  assert.equal(
    older.disclosure,
    "A Valo Content editor read this version before releasing it. No Nigerian legal, tax or sector specialist reviewed it.",
  );
});
