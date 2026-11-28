import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { capturedPassages } from "./guidance-captured-texts";
import { foodClaimMaps } from "./guidance-claims-food";
import { privacyClaimMaps } from "./guidance-claims-privacy";
import type { GuidePassage, GuidePassages } from "./guidance-passages";
import { readTemplateIntake } from "./operational-intake";
import {
  buildTemplateClaims,
  templateWords,
  type TemplateClaimMap,
  type TemplateSentence,
} from "./template-claim-map";
import { foodTemplateClaimMaps } from "./template-claims-food";
import { privacyTemplateClaimMaps } from "./template-claims-privacy";
import { lawTemplatePassageIds, mappedLawTemplateIds, templateLawClaimMaps } from "./template-law-maps";
import { guidanceOfficialHosts } from "../../platform/guidance-hosts";

/**
 * A template's claim map (docs/architecture/reviewed-route.md, part 4). The Data Protection Act's
 * words are not kept in the repository, so these tests cannot show that TPL-31's quotations are in
 * the Act. They show what can be shown without them: every word of the template is placed, every
 * sentence about the law names a recorded passage, and every quotation is one the privacy guides'
 * maps already make. The builder's own checks are shown on a stand-in template and stand-in passages.
 */
const tpl31 = privacyTemplateClaimMaps.find((m) => m.id === "TPL-31")!;
const blocks = async () => (await readTemplateIntake("TPL-31")).document.content.blocks;
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const supports = (m: TemplateClaimMap) =>
  m.sentences.flatMap((s) => ("support" in s ? (s.support ?? []) : []));

test("TPL-31's map places every word of its retained draft, in order, with nothing left over", async () => {
  assert.deepEqual(mappedLawTemplateIds, ["TPL-31", "TPL-29", "TPL-36"]);
  const words = templateWords(await blocks());
  assert.equal(flat(tpl31.sentences.map((s) => s.text).join(" ")), flat(words));
  const built = buildTemplateClaims(tpl31, await blocks(), () => undefined);
  assert.equal(built.scope.template, "TPL-31");
  assert.equal(built.scope.sentences, tpl31.sentences.length);
  assert.equal(
    Object.values(built.scope.byKind).reduce((a, b) => a + b, 0),
    tpl31.sentences.length,
  );
  // It states the law, so it is the source-backed policy's, never the templates' own policy's.
  assert.equal(built.statesLaw, true);
  assert.ok(built.scope.byKind.interpretation >= 1);
  // The agreement's clauses are terms the parties agree, not statements of what the law requires.
  assert.ok(built.scope.byKind.party_term > built.scope.byKind.interpretation);
});

test("each of TPL-31's sentences about the law names a recorded passage, quoted as the privacy guides quote it", () => {
  const recorded = new Set(capturedPassages.map((p) => p.id));
  const guideQuotes = new Set(
    privacyClaimMaps.flatMap((m) =>
      m.sentences.flatMap((s) => ("support" in s ? (s.support ?? []) : [])).map((q) => JSON.stringify(q)),
    ),
  );
  const named = supports(tpl31);
  assert.ok(named.length >= 2);
  for (const q of named) {
    assert.ok(recorded.has(q.passage), `${q.passage} is a recorded passage`);
    assert.ok(guideQuotes.has(JSON.stringify(q)), `${q.passage} ${q.locator} is quoted as a guide quotes it`);
  }
  assert.deepEqual(lawTemplatePassageIds("TPL-31").sort(), ["GAID-34", "NDPA-29", "NDPA-40"]);
  for (const s of tpl31.sentences)
    if (s.kind === "source_statement" || s.kind === "interpretation") assert.ok(s.support.length, s.text);
});

test("with no passage supplied, TPL-31's map still builds, and each sentence about the law is reported unbound", async () => {
  const built = buildTemplateClaims(tpl31, await blocks(), () => undefined);
  assert.deepEqual(built.claims, []);
  assert.deepEqual(built.sources, []);
  assert.equal(built.missingEvidence.length, supports(tpl31).length);
  assert.ok(built.missingEvidence.every((line) => /is not among the passages supplied/.test(line)));
});

const tpl29 = privacyTemplateClaimMaps.find((m) => m.id === "TPL-29")!;
const noticeBlocks = async () => (await readTemplateIntake("TPL-29")).document.content.blocks;

test("TPL-29's map places every word of its retained draft, in order, with nothing left over", async () => {
  const words = templateWords(await noticeBlocks());
  assert.equal(flat(tpl29.sentences.map((s) => s.text).join(" ")), flat(words));
  const built = buildTemplateClaims(tpl29, await noticeBlocks(), () => undefined);
  assert.equal(built.scope.template, "TPL-29");
  assert.equal(built.scope.sentences, tpl29.sentences.length);
  // A notice, not a contract: it states what it describes of the law, and exposes no parties' terms.
  assert.equal(tpl29.risk, "privacy");
  assert.equal(tpl29.contract, undefined);
  assert.equal(built.statesLaw, true);
  assert.deepEqual(built.assumptions, []);
  // What the business says of itself and of what it does are its own statements; the rights it
  // describes are readings of the Act, and a blank to complete is a practice.
  assert.deepEqual(built.scope.byKind, {
    source_statement: 0,
    interpretation: 6,
    party_term: 40,
    optional_practice: 5,
    template_limit: 0,
    not_a_claim: 47,
  });
});

test("each of TPL-29's sentences about the law names a recorded passage, quoted as the privacy guides quote it", async () => {
  const recorded = new Set(capturedPassages.map((p) => p.id));
  const guideQuotes = new Set(
    privacyClaimMaps.flatMap((m) =>
      m.sentences.flatMap((s) => ("support" in s ? (s.support ?? []) : [])).map((q) => JSON.stringify(q)),
    ),
  );
  for (const q of supports(tpl29)) {
    assert.ok(recorded.has(q.passage), `${q.passage} is a recorded passage`);
    assert.ok(guideQuotes.has(JSON.stringify(q)), `${q.passage} ${q.locator} is quoted as a guide quotes it`);
  }
  assert.deepEqual(lawTemplatePassageIds("TPL-29").sort(), [
    "GAID-37",
    "NDPA-25",
    "NDPA-26",
    "NDPA-27",
    "NDPA-34",
    "NDPA-36",
    "NDPA-37",
    "NDPA-38",
  ]);
  // With no passage supplied the map still builds, and each sentence about the law is reported unbound.
  const built = buildTemplateClaims(tpl29, await noticeBlocks(), () => undefined);
  assert.deepEqual(built.claims, []);
  assert.equal(built.missingEvidence.length, supports(tpl29).length);
});

const tpl36 = foodTemplateClaimMaps.find((m) => m.id === "TPL-36")!;
const recallBlocks = async () => (await readTemplateIntake("TPL-36")).document.content.blocks;

test("TPL-36's map places every word of its retained draft, in order, with nothing left over", async () => {
  const words = templateWords(await recallBlocks());
  assert.equal(flat(tpl36.sentences.map((s) => s.text).join(" ")), flat(words));
  const built = buildTemplateClaims(tpl36, await recallBlocks(), () => undefined);
  assert.equal(built.scope.template, "TPL-36");
  assert.equal(built.scope.sentences, tpl36.sentences.length);
  // A business's own recall procedure, not a contract. Its instructions are practices, what it
  // leaves to the risk assessment and the authority's directions are its limits, and its one
  // reading is that closing the business's record decides nothing an authority must decide.
  assert.equal(tpl36.risk, "regulated_sector");
  assert.equal(tpl36.contract, undefined);
  assert.equal(built.statesLaw, true);
  assert.deepEqual(built.assumptions, []);
  assert.deepEqual(built.scope.byKind, {
    source_statement: 0,
    interpretation: 1,
    party_term: 0,
    optional_practice: 24,
    template_limit: 3,
    not_a_claim: 112,
  });
});

test("TPL-36's sentence about the law names a recorded passage, quoted as the food guides quote it", async () => {
  const recorded = new Set(capturedPassages.map((p) => p.id));
  const guideQuotes = new Set(
    foodClaimMaps.flatMap((m) =>
      m.sentences.flatMap((s) => ("support" in s ? (s.support ?? []) : [])).map((q) => JSON.stringify(q)),
    ),
  );
  for (const q of supports(tpl36)) {
    assert.ok(recorded.has(q.passage), `${q.passage} is a recorded passage`);
    assert.ok(guideQuotes.has(JSON.stringify(q)), `${q.passage} ${q.locator} is quoted as a guide quotes it`);
  }
  assert.deepEqual(lawTemplatePassageIds("TPL-36"), ["NAFDAC-GMP-32-1"]);
  // With no passage supplied the map still builds, and its sentence about the law is reported unbound.
  const built = buildTemplateClaims(tpl36, await recallBlocks(), () => undefined);
  assert.deepEqual(built.claims, []);
  assert.equal(built.missingEvidence.length, 1);
});

test("TPL-31 exposes what it assumes about its parties and its use, and the clauses it leaves open (EDP-005)", async () => {
  const built = buildTemplateClaims(tpl31, await blocks(), () => undefined);
  const contract = tpl31.contract!;
  assert.equal(tpl31.risk, "contracts");
  assert.ok(contract.parties.length && contract.use.length && contract.openClauses.length);
  assert.deepEqual(built.assumptions, [
    ...contract.parties,
    ...contract.use,
    ...contract.openClauses.map((c) => `Left for the parties to settle: ${c}`),
  ]);
  // Every blank the agreement leaves in its clauses is named among the clauses left open.
  const words = templateWords(await blocks());
  for (const clause of [2, 4, 5, 6, 7, 8, 9]) {
    const heading = tpl31.ownNumbers!.find((o) => o.text.startsWith(`${clause}. `))!.text;
    const next = tpl31.ownNumbers!.find((o) => o.text.startsWith(`${clause + 1}. `))!.text;
    const body = words.slice(words.indexOf(heading), words.indexOf(next));
    assert.match(body, /\[[^\]]+\]/, `clause ${clause} leaves a blank`);
    assert.ok(
      contract.openClauses.some((c) => c.endsWith(`(clause ${clause})`)),
      `clause ${clause}'s blank is listed as left open`,
    );
  }
  // A map classed as a contract without them is refused.
  const { contract: _contract, ...withoutContract } = tpl31;
  assert.throws(
    () => buildTemplateClaims(withoutContract, [], () => undefined),
    /TEMPLATE_CONTRACT_EXPOSURE_MISSING/,
  );
  assert.throws(
    () => buildTemplateClaims({ ...tpl31, contract: { ...contract, openClauses: [] } }, [], () => undefined),
    /TEMPLATE_CONTRACT_EXPOSURE_MISSING/,
  );
});

// A stand-in template and stand-in passages: none of these words is a real template's or the law's.
const standInBlocks = [
  { type: "paragraph", text: "1. Stand-in clause", rows: [] },
  {
    type: "paragraph",
    text: "The parties agree a stand-in term. A stand-in rule requires notice within 30 days.",
    rows: [],
  },
  { type: "table", text: "", rows: [["Item", "[Details]"]] },
];
const standInPassage: GuidePassage = {
  id: "STAND-IN-1",
  recordedLocator: "section 7; stand-in",
  text: "7.—(1) A stand-in rule requires notice within 30 days of the stand-in event.",
  hash: sha256("7.—(1) A stand-in rule requires notice within 30 days of the stand-in event."),
  sections: ["7"],
  instrument: {
    id: "STAND-IN-ACT",
    kind: "act",
    url: "https://ndpc.gov.ng/stand-in.pdf",
    rawSha256: null,
    title: "Stand-in Act",
    issuingBody: "Stand-in issuer",
    retrievedAt: "2026-11-27T09:00:00.000Z",
    effectiveFrom: "2026-01-01T00:00:00+01:00",
  },
};
const standInPassages: GuidePassages = (id) => (id === standInPassage.id ? standInPassage : undefined);
const rule = {
  passage: "STAND-IN-1",
  from: "A stand-in rule requires",
  to: "within 30 days",
  locator: "section 7(1)",
};
const standInMap = (
  sentences: TemplateSentence[],
  extra: Partial<TemplateClaimMap> = {},
): TemplateClaimMap => ({
  id: "TPL-STAND-IN",
  risk: "privacy",
  ownNumbers: [{ text: "1. Stand-in clause", why: "The stand-in's own clause number." }],
  sentences,
  ...extra,
});
const placed: TemplateSentence[] = [
  { kind: "not_a_claim", text: "1. Stand-in clause" },
  { kind: "party_term", text: "The parties agree a stand-in term." },
  { kind: "source_statement", text: "A stand-in rule requires notice within 30 days.", support: [rule] },
  { kind: "not_a_claim", text: "Item" },
  { kind: "not_a_claim", text: "[Details]" },
];

test("a bound sentence becomes a claim with its quotation and its numbers, and its passage a source still held", () => {
  const built = buildTemplateClaims(standInMap(placed), standInBlocks, standInPassages);
  assert.equal(built.claims.length, 1);
  assert.deepEqual(built.claims[0], {
    text: "A stand-in rule requires notice within 30 days.",
    kind: "source_statement",
    sourceId: "STAND-IN-1",
    quote: "A stand-in rule requires notice within 30 days",
    locator: "section 7(1)",
    numbers: ["30"],
  });
  assert.equal(built.sources.length, 1);
  assert.equal(built.sources[0]!.status, "held");
  assert.equal(built.sources[0]!.operativeTextConfirmed, false);
  assert.deepEqual(built.missingEvidence, []);
  assert.deepEqual(built.scope.byKind, {
    source_statement: 1,
    interpretation: 0,
    party_term: 1,
    optional_practice: 0,
    template_limit: 0,
    not_a_claim: 3,
  });
});

test("the builder refuses a map that misplaces, leaves out or misclassifies a template's words", () => {
  const build = (sentences: TemplateSentence[], extra: Partial<TemplateClaimMap> = {}) =>
    buildTemplateClaims(standInMap(sentences, extra), standInBlocks, standInPassages);
  const swap = (i: number, s: TemplateSentence) => placed.map((x, j) => (j === i ? s : x));

  // Words out of order, or words the template does not hold.
  assert.throws(() => build([placed[1]!, placed[0]!, ...placed.slice(2)]), /TEMPLATE_CLAIM_MAP_SENTENCE/);
  assert.throws(
    () => build(swap(1, { kind: "party_term", text: "The parties agree another term." })),
    /TEMPLATE_CLAIM_MAP_SENTENCE/,
  );
  // Words left unplaced.
  assert.throws(() => build(placed.slice(0, -1)), /TEMPLATE_CLAIM_MAP_INCOMPLETE/);
  // A sentence about the law with nothing to rest on.
  assert.throws(
    () => build(swap(2, { kind: "interpretation", text: placed[2]!.text, support: [] })),
    /TEMPLATE_CLAIM_MAP_UNSUPPORTED/,
  );
  // A term, a limit or a heading that claims a passage.
  for (const kind of ["party_term", "template_limit", "not_a_claim"] as const)
    assert.throws(
      () => build(swap(1, { kind, text: placed[1]!.text, support: [rule] } as unknown as TemplateSentence)),
      /TEMPLATE_CLAIM_MAP_SUPPORT_NOT_ALLOWED/,
    );
  // A quotation whose words are not in the passage, or a place the passage does not bear out.
  assert.throws(
    () =>
      build(
        swap(2, {
          kind: "source_statement",
          text: placed[2]!.text,
          support: [{ ...rule, from: "A stand-in duty" }],
        }),
      ),
    /TEMPLATE_CLAIM_QUOTE_ANCHOR/,
  );
  assert.throws(
    () =>
      build(
        swap(2, {
          kind: "source_statement",
          text: placed[2]!.text,
          support: [{ ...rule, locator: "section 9(1)" }],
        }),
      ),
    /TEMPLATE_CLAIM_LOCATOR/,
  );
  // A number the quoted words do not contain, even in a term the parties agree.
  assert.throws(
    () =>
      build(
        swap(2, {
          kind: "source_statement",
          text: placed[2]!.text,
          support: [{ ...rule, to: "requires notice" }],
        }),
      ),
    /TEMPLATE_CLAIM_NUMBER_UNSUPPORTED/,
  );
  assert.throws(
    () => build(swap(2, { kind: "party_term", text: placed[2]!.text })),
    /TEMPLATE_CLAIM_NUMBER_UNSUPPORTED/,
  );
  // A clause number that is not declared as the template's own, or one declared without a reason.
  assert.throws(() => build(placed, { ownNumbers: [] }), /TEMPLATE_CLAIM_NUMBER_UNSUPPORTED/);
  assert.throws(
    () => build(placed, { ownNumbers: [{ text: "1. Stand-in clause", why: " " }] }),
    /TEMPLATE_CLAIM_MAP_OWN_NUMBER/,
  );
});

test("a template's links are reported by their hosts, for the mechanical checks to hold to the policy's", async () => {
  const words =
    "See https://ndpc.gov.ng/complaints and https://example.com/x, or https://ndpc.gov.ng again, not https://[unreadable.";
  const built = buildTemplateClaims(
    standInMap([{ kind: "not_a_claim", text: words }], { ownNumbers: [] }),
    [{ type: "paragraph", text: words, rows: [] }],
    standInPassages,
  );
  assert.deepEqual(built.linkHosts, ["ndpc.gov.ng", "example.com"]);
  // The mapped templates link only to hosts the proposed policy lists: TPL-29 to the Commission's.
  for (const map of templateLawClaimMaps) {
    const own = (await readTemplateIntake(map.id)).document.content.blocks;
    const { linkHosts } = buildTemplateClaims(map, own, () => undefined);
    for (const host of linkHosts)
      assert.ok((guidanceOfficialHosts as readonly string[]).includes(host), `${map.id} links to ${host}`);
  }
});

test("a template whose map places no sentence about the law is not the source-backed policy's", () => {
  const built = buildTemplateClaims(
    standInMap([
      placed[0]!,
      placed[1]!,
      { kind: "optional_practice", text: placed[2]!.text, support: [rule] },
      placed[3]!,
      placed[4]!,
    ]),
    standInBlocks,
    standInPassages,
  );
  // A practice may point to a passage, as a guide's may; it states no law.
  assert.equal(built.statesLaw, false);
  assert.equal(built.claims[0]!.kind, "optional_practice");
});
