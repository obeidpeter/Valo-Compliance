import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { candidateDigest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import {
  GUIDANCE_DRAFT_NOTICE,
  GUIDANCE_NOTICE,
  TEMPLATE_NOTICE,
  closeRenderer,
  renderDocument,
} from "../../lib/valo-render";
import { buildGuideCandidate, mappedGuideIds } from "./guidance-bundle";
import { guidanceCandidate } from "./guidance-candidate";
import {
  GUIDE_LABEL,
  GUIDE_PART,
  GUIDE_REVIEW_MEANING,
  guideBodyBlocks,
  guideOwnBlocks,
  guideSourceLines,
  guideReferences,
  guidanceReleaseDocument,
} from "./guidance-document";
import { inspectOperationalExports } from "./operational-export-inspection";
import { readGuidanceIntake } from "./operational-intake";

const execFile = promisify(execCallback);
const guideIds = Array.from({ length: 30 }, (_, i) => `GUD-${String(i + 1).padStart(2, "0")}`);
// Where CI keeps the sample files, so a person can open them. Unset, nothing is kept.
const samples = process.env.VALO_GUIDANCE_SAMPLES || undefined;
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The text of a PDF as a reader extracts it, and of a Word file's body. */
async function pdfText(pdf: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "valo-guide-"));
  try {
    await writeFile(join(dir, "guide.pdf"), pdf);
    return (await execFile("pdftotext", ["-layout", join(dir, "guide.pdf"), "-"])).stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const docxText = (docx: Buffer) =>
  strFromU8(unzipSync(docx)["word/document.xml"]!)
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');

/** Only what the export inspection reads. A guide's risk class, claims and sources are not decided
 * here, and nothing in this file reviews a guide or makes it eligible. */
function inspected(
  id: string,
  content: Awaited<ReturnType<typeof guidanceCandidate>>,
): PublicationBundle["candidate"] {
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id,
    version: 1,
    body: JSON.stringify(content.document),
    contentClass: "sourced_guidance",
    jurisdiction: "NG",
    risk: "governance",
    scope: content.scope,
    limitations: content.limitations,
    assumptions: ["Controlled export test only"],
    unresolvedMaterialIssues: [],
    missingEvidence: ["Controlled export test only: no review, rights record or source decision"],
    sourceCheckDate: content.reviewedAt,
    reviewBy: content.reviewBy,
    disclosure,
    claims: [],
    evidenceMode: "regulatory",
    legalScopeStatus: "unverified",
    coverage: { kind: "guidance", industrySlugs: [], locationIds: [] },
  };
  return { ...raw, hash: candidateDigest(raw) };
}

test.after(() => closeRenderer());

test("every draft guide prints as a guide in Word and PDF, and the files hold everything in it", async () => {
  if (samples) {
    await mkdir(samples, { recursive: true });
    await writeFile(
      join(samples, "READ-ME-FIRST.txt"),
      [
        "Samples of the thirty draft guides, GUD-01 to GUD-30, printed to check a guide's layout in Word and PDF.",
        "",
        "None of these drafts has been reviewed, and none is published.",
        'The line "AI drafted and reviewed; ..." near the end of each file is the notice a released guide carries.',
        "It is printed here so that the layout is complete. It is not a statement about these drafts.",
        "GUD-01 to GUD-10 list their sources, read on 14 November 2026. The other guides list none:",
        "a guide's sources come from its claim map, and theirs are not written yet.",
        "",
      ].join("\n"),
    );
  }
  const now = new Date();
  for (const id of guideIds) {
    // A guide with a claim map is printed as that map builds it, sources and all; any other is
    // printed from its words alone.
    const mapped = mappedGuideIds.includes(id) ? await buildGuideCandidate(id) : null;
    const document = mapped?.document ?? (await guidanceCandidate(id, 1, now)).document;
    const candidate = mapped?.candidate ?? inspected(id, await guidanceCandidate(id, 1, now));
    const files = {
      docx: await renderDocument(document, "docx", 1, "guidance_draft"),
      pdf: await renderDocument(document, "pdf", 1, "guidance_draft"),
    };
    const report = await inspectOperationalExports(candidate, files, GUIDANCE_DRAFT_NOTICE);
    assert.equal(report.passed, true, `${id}: ${JSON.stringify(report)}`);
    for (const format of ["docx", "pdf"] as const) {
      const f = report.formats[format];
      assert.ok(f.disclosureIncluded && f.scopeIncluded && f.limitationsIncluded && f.sourceDateIncluded, id);
    }

    for (const [format, text] of [
      ["Word", docxText(files.docx)],
      ["PDF", await pdfText(files.pdf)],
    ] as const) {
      const where = `${id} ${format}`;
      assert.ok(flat(text).includes(GUIDANCE_DRAFT_NOTICE), `${where}: says it is an unreviewed draft`);
      assert.ok(text.includes("Valo · Guide version 1"), `${where}: names the guide's version`);
      // Nothing of a template's file: its notice, its business fields or their empty values.
      assert.ok(!flat(text).includes(TEMPLATE_NOTICE) && !/BLANK DEVELOPMENT TEMPLATE/.test(text), where);
      assert.ok(!/Not supplied|issuerName|recipientName|documentNumber|issueDate|dueDate/.test(text), where);
      assert.ok(!/Saved revision|Saved version/.test(text), where);
      // No drafting marks: a link's brackets, a heading's hashes or emphasis asterisks.
      assert.ok(!/\]\(|^#{1,6}\s|\*\*/m.test(text), `${where}: no drafting marks`);
      for (const label of [
        GUIDE_LABEL.covers,
        GUIDE_LABEL.limits,
        GUIDE_LABEL.written,
        GUIDE_LABEL.sourcesChecked,
      ])
        assert.ok(text.includes(`${label}:`), `${where}: ${label}`);
      assert.equal(
        text.includes(`${GUIDE_LABEL.sources}:`),
        Boolean(mapped),
        `${where}: lists sources only with a claim map`,
      );
    }

    // The inspection is bound to this candidate: the same files fail for one that says more.
    const altered = { ...candidate, scope: `${candidate.scope} Added claim absent from the files.` };
    altered.hash = candidateDigest(altered);
    assert.equal((await inspectOperationalExports(altered, files, GUIDANCE_DRAFT_NOTICE)).passed, false, id);

    if (samples) {
      await writeFile(join(samples, `${id}-unreviewed-draft-sample.docx`), files.docx);
      await writeFile(join(samples, `${id}-unreviewed-draft-sample.pdf`), files.pdf);
    }
  }
});

test("a guide prepared with its claim map lists each source with its place and official address", async () => {
  // GUD-01 as its claim map builds it: a real candidate, with the sources its claims point to.
  const built = await buildGuideCandidate("GUD-01");
  const references = guideReferences(built);
  assert.ok(references.length >= 8, "GUD-01's claims point to several places");
  assert.ok(references.every((r) => r.url.startsWith("https://")));
  assert.equal(
    new Set(references.map((r) => `${r.url} ${r.locator}`)).size,
    references.length,
    "each place is listed once",
  );

  const files = {
    docx: await renderDocument(built.document, "docx", 1, "guidance"),
    pdf: await renderDocument(built.document, "pdf", 1, "guidance"),
  };
  // A guide's candidate is inspected against the released guide's notice without being told to.
  const report = await inspectOperationalExports(built.candidate, files);
  assert.equal(report.passed, true, JSON.stringify(report));
  for (const [format, text] of [
    ["Word", docxText(files.docx)],
    ["PDF", await pdfText(files.pdf)],
  ] as const) {
    assert.ok(flat(text).includes(GUIDANCE_NOTICE), `${format}: the released guide's notice`);
    assert.ok(!flat(text).includes(GUIDANCE_DRAFT_NOTICE), `${format}: not the draft notice`);
    assert.ok(text.includes(`${GUIDE_LABEL.sources}:`), `${format}: the sources' heading`);
    // A long line may break anywhere, so a place and an address are looked for without spaces.
    const packed = text.replace(/\s+/g, "");
    for (const r of references) {
      assert.ok(packed.includes(r.locator.replace(/\s+/g, "")), `${format}: ${r.locator}`);
      assert.ok(packed.includes(r.url), `${format}: ${r.url}`);
    }
    // The sources were read on 14 November 2026, and the file says so.
    assert.ok(text.includes("Sources checked: 14 Nov 2026"), `${format}: the day the sources were read`);
  }
});

test("a guide's words become paragraphs and lists, with each link written out", async () => {
  const gud01 = guideBodyBlocks("GUD-01", (await readGuidanceIntake("GUD-01")).section.body);
  assert.equal(gud01.length, 4);
  assert.ok(gud01.every((b) => b.type === "paragraph"));
  assert.ok(
    gud01[3]!.text.includes("CAC business-name route (https://www.cac.gov.ng/services/business-name)"),
    "the link is its words, then its address",
  );
  assert.ok(!gud01.some((b) => /\]\(|\[/.test(b.text)));

  const gud29 = guideBodyBlocks("GUD-29", (await readGuidanceIntake("GUD-29")).section.body);
  const list = gud29.filter((b) => b.type === "list");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]!.text.split("\n").slice(0, 2), [
    "Confirm the applicable source and contract version.",
    "Check service dates, units and arithmetic.",
  ]);
  assert.equal(gud29[gud29.indexOf(list[0]!) - 1]!.text, "Before approving or changing a record:");

  // Marks a file would print as they stand are refused, not passed on.
  for (const body of [
    "## A heading\n\nWords.",
    "| a | b |\n| - | - |\n| 1 | 2 |",
    "Some **bold** words.",
    "A [link](http://example.test/plain-http) that is not https.",
    "An introduction:\n- with a bullet on the next line",
    "1. A numbered step.",
    "Words in `code`.",
  ])
    assert.throws(() => guideBodyBlocks("GUD-01", body), /GUIDANCE_BODY_MARKUP/, body);
  assert.throws(() => guideBodyBlocks("GUD-01", "  \n\n  "), /GUIDANCE_BODY_EMPTY/);
  assert.throws(() => guideBodyBlocks("TPL-01", "Words."), /GUIDANCE_ID_REQUIRED/);
});

test("a guide's document keeps its own words apart from the parts added to them", async () => {
  const intake = await readGuidanceIntake("GUD-03");
  const references = [
    { title: "A synthetic source", locator: "section 1", url: "https://example.test/one" },
    { title: "A synthetic source", locator: "section 2", url: "https://example.test/one" },
  ];
  const document = guidanceReleaseDocument({
    section: intake.section,
    scope: "Synthetic scope.",
    limitations: "Synthetic limits.",
    // Half past eleven at night in UTC is already the next day in Lagos.
    sourcesCheckedAt: "2026-11-21T23:30:00.000Z",
    references,
  });
  const blocks = document.content.blocks;
  assert.deepEqual(guideOwnBlocks(blocks), intake.document.content.blocks);
  const part = (id: string) => blocks.find((b) => b.id === id)!;
  assert.equal(part(GUIDE_PART.covers).text, "What it covers: Synthetic scope.");
  assert.equal(part(GUIDE_PART.limits).text, "Limits you should know: Synthetic limits.");
  assert.equal(part(GUIDE_PART.sources).type, "list");
  // One line for the text, with both places and one address.
  assert.deepEqual(guideSourceLines(references), [
    "A synthetic source: section 1; section 2. https://example.test/one",
  ]);
  assert.equal(part(GUIDE_PART.sources).text, guideSourceLines(references).join("\n"));
  assert.equal(part(GUIDE_PART.written).text, `How it was written and checked: ${disclosure}`);
  assert.equal(part(GUIDE_PART.reviewMeaning).text, GUIDE_REVIEW_MEANING);
  assert.equal(
    part(GUIDE_PART.sourcesChecked).text,
    "Sources checked: 22 Nov 2026 (2026-11-21T23:30:00.000Z).",
  );
  // The notice never calls the two AI checks a professional review.
  assert.ok(/two separate automated AI checks/.test(GUIDE_REVIEW_MEANING));
  assert.ok(/not legal or regulatory verification/.test(GUIDE_REVIEW_MEANING));
  assert.ok(Object.values(document.content.fields).every((v) => v === ""));

  assert.throws(
    () =>
      guidanceReleaseDocument({
        section: intake.section,
        scope: "s",
        limitations: "l",
        sourcesCheckedAt: "2026-11-21T23:30:00.000Z",
        references: [{ title: "t", locator: "l", url: "http://example.test/plain" }],
      }),
    /GUIDANCE_REFERENCE_NOT_HTTPS/,
  );
});
