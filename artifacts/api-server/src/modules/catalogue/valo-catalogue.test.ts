import assert from "node:assert/strict";
import test from "node:test";
import { paginateReleasedItems } from "./valo-catalogue";
import { manualCatalogue, manualResource } from "./manual-presentation";
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
    fileFormat: "docx",
  });
  assert.equal(baselineTemplate.type, "template");
  assert.equal(baselineTemplate.category, "Finance and operations");
  assert.equal(baselineTemplate.access, "free");

  const customPremium = manualCatalogue({
    ...base,
    kind: "premium_template",
    title: "Custom sector checklist",
    fileFormat: "pdf",
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
