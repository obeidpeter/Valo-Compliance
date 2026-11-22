import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { beforeEach, afterEach, type TestContext } from "node:test";
import { baselineTemplates, coveragePlan, digest, sha256 } from "@workspace/valo-core";
import { industryDraftPath, originalProvenanceNote } from "../lib/retained-content-sections";
import { prepareIndustryReviewPacket } from "../modules/publication";
import { runIndustryGuideReviews } from "./industry-guide-reviews";

const originalNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "development";
});
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

async function temporaryDirectory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "valo-industry-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("each category and each deeper pack contains its exact retained text, notes and two independently bound briefs", async () => {
  const packet = await prepareIndustryReviewPacket();
  const plan = coveragePlan();
  assert.equal(packet.status, "awaiting-independent-reviews");
  assert.deepEqual(
    packet.records
      .filter(({ candidate }) => candidate.draft.kind === "introduction")
      .map(({ candidate }) => candidate.industry.slug),
    plan.industries.map((i) => i.slug),
  );
  assert.deepEqual(
    packet.records
      .filter(({ candidate }) => candidate.draft.kind === "deeper-pack")
      .map(({ candidate }) => candidate.industry.slug),
    plan.industries.filter((i) => i.deeperPackTarget).map((i) => i.slug),
  );
  assert.equal(new Set(packet.records.map((r) => r.candidate.source.identity)).size, 26);
  assert.equal(new Set(packet.records.map((r) => r.candidateSha256)).size, 26);
  const text = await readFile(resolve(import.meta.dirname, "../../../..", industryDraftPath), "utf8");
  for (const { candidate, candidateSha256, reviewBriefs } of packet.records) {
    const { draft, editorialNotes, industry, source } = candidate;
    const heading = draft.kind === "introduction" ? industry.title : `${industry.title} — deeper pack`;
    assert.equal(source.identity, industryDraftPath + "#" + heading);
    assert.equal(industry.intendedPage, "/industries/" + industry.slug);
    const start = text.indexOf("### " + heading + "\n");
    assert.ok(start >= 0);
    const remainder = text.slice(start + 4);
    const boundary = remainder.search(/^#{1,3} /m);
    const originalSection = "### " + (boundary < 0 ? remainder : remainder.slice(0, boundary));
    assert.equal(sha256(originalSection), source.baselineSectionSha256);
    const body =
      draft.kind === "introduction"
        ? [...draft.paragraphs, "**Template connections:** " + editorialNotes.templateConnections]
        : [
            "**Purpose:** " + draft.purpose,
            ...draft.steps.map((step, i) => `${i + 1}. **${step.heading}** ${step.text}`),
            "**Questions to resolve:** " + editorialNotes.questions,
          ];
    assert.equal(
      draft.kind === "introduction" ? draft.paragraphs.length : draft.steps.length,
      draft.kind === "introduction" ? 2 : 5,
    );
    assert.deepEqual(originalSection.trim().split("\n").filter(Boolean), [
      "### " + heading,
      ...body,
      "**Candidate source leads:** " + editorialNotes.sourceLeads,
    ]);
    const originalIds = [...new Set(originalSection.match(/\bTPL-\d+\b/g) ?? [])];
    assert.deepEqual(
      editorialNotes.proposedTemplates.map((tpl) => tpl.id),
      originalIds,
    );
    assert.ok(
      editorialNotes.proposedTemplates.every(({ id, title }) =>
        baselineTemplates.some((tpl) => tpl.id === id && tpl.title === title),
      ),
    );
    assert.equal(
      editorialNotes.enhancedEvidenceRequired,
      ["healthcare", "energy", "financial-services"].includes(industry.slug),
    );
    assert.equal(candidateSha256, digest(candidate));
    assert.deepEqual(
      reviewBriefs.map((b) => [b.role, b.candidateSha256]),
      [
        ["factual", candidateSha256],
        ["challenge", candidateSha256],
      ],
    );
    assert.notDeepEqual(reviewBriefs[0]!.instructions, reviewBriefs[1]!.instructions);
  }
});

test("concurrent preparations and re-verification produce one complete, reproducible file", async (t) => {
  const dir = await temporaryDirectory(t);
  const path = join(dir, "review.json");
  const [first, second] = await Promise.all([
    runIndustryGuideReviews(["prepare", path]),
    runIndustryGuideReviews(["prepare", path]),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.introductions, 20);
  assert.equal(first.deeperPacks, 6);
  assert.equal(first.reviewBriefs, 52);
  assert.deepEqual(first, await runIndustryGuideReviews(["verify", path]));
  assert.deepEqual(await readdir(dir), ["review.json"]);
});

test("a missing draft, reassigned category, edited brief, self-rehashed revision or broken file cannot verify or replace an existing file", async (t) => {
  const path = join(await temporaryDirectory(t), "review.json");
  const packet = await prepareIndustryReviewPacket();
  const missing = structuredClone(packet);
  missing.records.pop();
  const reassigned = structuredClone(packet);
  reassigned.records[0]!.candidate.industry = reassigned.records[2]!.candidate.industry;
  const brief = structuredClone(packet);
  brief.records[0]!.reviewBriefs[1]!.candidateSha256 = brief.records[1]!.candidateSha256;
  const changed = structuredClone(packet);
  const record = changed.records[0]!;
  assert.ok(record.candidate.draft.kind === "introduction");
  record.candidate.draft.paragraphs[0] = "A replacement paragraph.";
  record.candidateSha256 = digest(record.candidate);
  for (const task of record.reviewBriefs) task.candidateSha256 = record.candidateSha256;
  for (const bytes of [...[missing, reassigned, brief, changed].map((p) => JSON.stringify(p)), "{"]) {
    await writeFile(path, bytes);
    for (const action of ["verify", "prepare"])
      await assert.rejects(runIndustryGuideReviews([action, path]), /INDUSTRY_PACKET_/);
    assert.equal(await readFile(path, "utf8"), bytes);
  }
  assert.deepEqual(await readdir(dirname(path)), ["review.json"]);
});

test("altered original prose or authoring evidence is rejected before an output file is created", async (t) => {
  const dir = await temporaryDirectory(t);
  const root = resolve(import.meta.dirname, "../../../..");
  const marker = join(dir, "docs/specification/master-execution-prompt.txt");
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, "");
  await mkdir(dirname(join(dir, industryDraftPath)), { recursive: true });
  const paths = [industryDraftPath, originalProvenanceNote.path];
  for (const path of paths) await writeFile(join(dir, path), await readFile(join(root, path)));
  t.mock.method(process, "cwd", () => dir);
  for (const path of paths) {
    const original = await readFile(join(root, path), "utf8");
    await writeFile(join(dir, path), original + "\n");
    await assert.rejects(
      runIndustryGuideReviews(["prepare", join(dir, "review.json")]),
      /INDUSTRY_ORIGINAL_CHANGED/,
    );
    await writeFile(join(dir, path), original);
  }
  assert.deepEqual(await readdir(dir), ["docs"]);
});

test("a deployed environment cannot create or verify review packets", async (t) => {
  const dir = await temporaryDirectory(t);
  const path = join(dir, "review.json");
  process.env.NODE_ENV = "production";
  for (const action of ["prepare", "verify"])
    await assert.rejects(runIndustryGuideReviews([action, path]), /development is required/);
  process.env.NODE_ENV = "development";
  const previous = process.env.REPLIT_DEPLOYMENT_ID;
  process.env.REPLIT_DEPLOYMENT_ID = "synthetic-deployment";
  t.after(() => {
    if (previous === undefined) delete process.env.REPLIT_DEPLOYMENT_ID;
    else process.env.REPLIT_DEPLOYMENT_ID = previous;
  });
  await assert.rejects(runIndustryGuideReviews(["prepare", path]), /development is required/);
  await assert.rejects(runIndustryGuideReviews(["publish", path]), /Expected prepare or verify/);
  assert.deepEqual(await readdir(dir), []);
});
