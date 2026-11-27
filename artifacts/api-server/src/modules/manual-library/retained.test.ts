import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { coveragePlan } from "@workspace/valo-core";
import {
  readGuidanceIntake,
  readPracticalGuideIntake,
  readTemplateIntake,
  retainedIndustryDrafts,
} from "../publication";
import { registeredManualGuidance } from "../manual-guidance/regulatory-evidence";
import { readEditorialUpload, fileLimit } from "./files";
import {
  premiumDescription,
  retainedDrafts,
  retainedItemId,
  retainedTemplateFile,
  templateText,
  type RetainedDraft,
} from "./retained";

// The retained drafts are read only in development, as the staff library is used only there.
const originalNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "development";
});
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

let read: Promise<RetainedDraft[]> | undefined;
const drafts = () => (read ??= retainedDrafts());
const ofKind = async (kind: RetainedDraft["kind"]) => (await drafts()).filter((d) => d.kind === kind);

test("the 108 drafts kept in the repository are each read once, under a library item of their own", async () => {
  const all = await drafts();
  const count = (kind: RetainedDraft["kind"]) => all.filter((d) => d.kind === kind).length;
  assert.deepEqual(
    {
      template: count("template"),
      premium_template: count("premium_template"),
      practical_guide: count("practical_guide"),
      industry_introduction: count("industry_introduction"),
      industry_pack: count("industry_pack"),
      regulatory_article: count("regulatory_article"),
    },
    {
      template: 12,
      premium_template: 28,
      practical_guide: 12,
      industry_introduction: 20,
      industry_pack: 6,
      regulatory_article: 30,
    },
  );
  assert.equal(new Set(all.map((d) => d.retainedId)).size, 108);
  const items = all.map((d) => retainedItemId(d.retainedId));
  assert.equal(new Set(items).size, 108);
  for (const id of items)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // The same draft is filed under the same item on every run.
  assert.equal(retainedItemId("TPL-01"), retainedItemId("TPL-01"));
  assert.notEqual(retainedItemId("TPL-01"), retainedItemId("TPL-02"));
  for (const d of all) {
    assert.ok(d.title.length >= 1 && d.title.length <= 140 && !/[\n\r\t]/.test(d.title), d.retainedId);
    assert.ok(d.body.length >= 1 && d.body.length <= 60000, d.retainedId);
    assert.equal(d.body, d.body.trim(), d.retainedId);
  }
  // An introduction and a pack each belong to one listed industry, which has one of each at most.
  const slugs = new Set(coveragePlan().industries.map((i) => i.slug));
  for (const kind of ["industry_introduction", "industry_pack"] as const) {
    const placed = all.filter((d) => d.kind === kind).map((d) => d.industry);
    assert.ok(
      placed.every((slug) => slug !== null && slugs.has(slug)),
      kind,
    );
    assert.equal(new Set(placed).size, placed.length, kind);
  }
  assert.deepEqual(
    all.filter((d) => d.kind === "industry_pack").map((d) => d.industry),
    coveragePlan()
      .industries.filter((i) => i.deeperPackTarget)
      .map((i) => i.slug),
  );
  assert.ok(
    all
      .filter((d) => !["industry_introduction", "industry_pack"].includes(d.kind))
      .every((d) => d.industry === null),
  );
});

test("a regulatory guide's draft is exactly the text the owner's source check recognises", async () => {
  for (const d of await ofKind("regulatory_article")) {
    const { section } = await readGuidanceIntake(d.retainedId);
    assert.equal(d.title, section.title);
    assert.equal(d.body, section.body);
    assert.equal(await registeredManualGuidance(d.title, d.body), d.retainedId);
  }
});

test("a practical guide's draft is the reviewed route's text where that route prepares one, and leaves editorial lines out", async () => {
  const guides = await ofKind("practical_guide");
  assert.deepEqual(
    guides.map((d) => d.retainedId),
    Array.from({ length: 12 }, (_, i) => `GUIDE-C${String(i + 1).padStart(2, "0")}`),
  );
  for (const id of ["GUIDE-C01", "GUIDE-C02", "GUIDE-C03", "GUIDE-C04"]) {
    const { section } = await readPracticalGuideIntake(id);
    const draft = guides.find((d) => d.retainedId === id)!;
    assert.equal(draft.body, section.body, id);
    assert.equal(draft.title, section.title, id);
  }
  for (const d of guides) {
    assert.doesNotMatch(d.body, /^Status:/m, d.retainedId);
    assert.doesNotMatch(d.body, /^Suggested related/m, d.retainedId);
  }
  // A suggestion that names a next step keeps the next step.
  assert.match(guides.find((d) => d.retainedId === "GUIDE-C01")!.body, /^Next step: /m);
});

test("an industry draft keeps its customer text and leaves out editorial notes and template IDs", async () => {
  const industry = await retainedIndustryDrafts();
  const introductions = await ofKind("industry_introduction");
  const packs = await ofKind("industry_pack");
  for (const d of [...introductions, ...packs]) {
    assert.doesNotMatch(
      d.body,
      /Template connections|Candidate source leads|Questions to resolve|TPL-\d|\*\*|DRAFT/,
      d.retainedId,
    );
  }
  for (const [index, d] of introductions.entries()) {
    const source = industry.filter((x) => x.draft.kind === "introduction")[index]!;
    assert.equal(d.industry, source.industry.slug);
    assert.equal(source.draft.kind, "introduction");
    if (source.draft.kind === "introduction") assert.equal(d.body, source.draft.paragraphs.join("\n\n"));
    assert.match(d.title, /: where to start$/);
  }
  for (const d of packs) {
    const steps = d.body.split("\n\n")[1]!.split("\n");
    assert.deepEqual(
      steps.map((step) => step.split(".")[0]),
      ["1", "2", "3", "4", "5"],
      d.retainedId,
    );
    assert.match(d.title, /: five practical steps$/);
  }
  // A template a pack names by ID is named by its title.
  assert.match(packs[0]!.body, /Use the Purchase order template to capture the supplier/);
});

test("a template's draft is its text without Markdown marks, and a premium template's is a description of at most 600 characters", async () => {
  for (const d of await ofKind("template")) {
    assert.doesNotMatch(d.body, /\*\*|^\s*\|[\s:|-]+\|\s*$|^#{1,6} /m, d.retainedId);
    assert.equal(d.body, templateText((await readTemplateIntake(d.retainedId)).section.body));
  }
  assert.equal(templateText("# INVOICE\n\n| A | B |\n|---|---:|\n| **1** | 2 |"), "INVOICE\n\nA | B\n1 | 2");
  for (const d of await ofKind("premium_template")) {
    assert.ok(d.body.length <= 600, d.retainedId);
    assert.ok(d.body.startsWith(`A blank ${d.title.toLowerCase()} template`), d.retainedId);
  }
  assert.equal(
    premiumDescription("Service agreement", "## 1. Services\n\nText\n\n## 2. Payment:\n\nText"),
    "A blank service agreement template to complete with your own details, as a Word file. It covers: Services; Payment.",
  );
  assert.equal(
    premiumDescription("Board resolution", "No headings here."),
    "A blank board resolution template to complete with your own details, as a Word file.",
  );
  const long = premiumDescription(
    "Employee handbook",
    Array.from({ length: 60 }, (_, i) => `## Part ${i + 1} of the handbook`).join("\n\n"),
  );
  assert.ok(long.length <= 600 && long.endsWith("; and more."));
});

test("every template's Word file is the blank master the reviewed route renders, and passes the library's upload check", async () => {
  for (const d of [...(await ofKind("template")), ...(await ofKind("premium_template"))]) {
    const bytes = await retainedTemplateFile(d.template!);
    assert.ok(bytes.length > 0 && bytes.length <= fileLimit, d.retainedId);
    const upload = await readEditorialUpload("docx", bytes.toString("base64"));
    assert.equal(upload.file.format, "docx");
    assert.match(upload.text, /BLANK DEVELOPMENT TEMPLATE/, d.retainedId);
  }
});
