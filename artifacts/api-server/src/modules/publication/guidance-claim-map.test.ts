import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateDigest,
  evaluatePublication,
  publicationSchema,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import type { valoContentVersions } from "@workspace/db";
import { projectReleasedResource } from "../catalogue/valo-released-content";
import { heldSourceBundle } from "../sources/valo-source-controls.fixtures";
import { claimLocatorMatches } from "./claim-locator";
import { buildGuideCandidate, guideClaimMaps, mappedGuideIds } from "./guidance-bundle";
import { GUIDE_LIMITATIONS, GUIDE_SCOPE } from "./guidance-candidate";
import {
  buildGuideClaims,
  statedNumbers,
  type GuideClaimMap,
  type GuideSentence,
} from "./guidance-claim-map";
import { guideBodyBlocks, guideOwnBlocks, guideSourceLines } from "./guidance-document";
import { retainedGuidePassages, type GuidePassage } from "./guidance-passages";
import { guidanceOfficialHosts } from "./guidance-policy";
import { readGuidanceIntake } from "./operational-intake";

const passages = retainedGuidePassages();
const body = async (id: string) => (await readGuidanceIntake(id)).section.body;
const map = (id: string) => guideClaimMaps.find((m) => m.id === id)!;
/** A guide's map with one sentence changed. */
const changed = (id: string, index: number, change: (s: GuideSentence) => GuideSentence): GuideClaimMap => ({
  ...map(id),
  sentences: map(id).sentences.map((s, i) => (i === index ? change(s) : s)),
});
const indexOf = (id: string, start: string) => {
  const at = map(id).sentences.findIndex((s) => s.text.startsWith(start));
  assert.ok(at >= 0, `${id} has a sentence starting "${start}"`);
  return at;
};

test("the ten registration and tax guides are mapped, and each map places every sentence of its guide", async () => {
  assert.deepEqual(
    mappedGuideIds,
    Array.from({ length: 10 }, (_, i) => `GUD-${String(i + 1).padStart(2, "0")}`),
  );
  for (const m of guideClaimMaps) {
    const text = guideBodyBlocks(m.id, await body(m.id))
      .map((b) => b.text)
      .join("\n");
    // Put back together, the map's sentences are the guide's words, with nothing left over.
    assert.equal(m.sentences.map((s) => s.text).join(" "), text.replace(/\n/g, " "), m.id);
    const built = buildGuideClaims(m, await body(m.id), passages);
    assert.equal(built.scope.sentences, m.sentences.length, m.id);
    assert.equal(
      Object.values(built.scope.byKind).reduce((a, b) => a + b, 0),
      m.sentences.length,
      m.id,
    );
    assert.ok(built.scope.byKind.source_statement >= 4, `${m.id} states what its sources say`);
  }
});

test("every quotation is word for word in its retained passage, at the place its locator gives", async () => {
  let claims = 0;
  for (const m of guideClaimMaps) {
    const built = buildGuideClaims(m, await body(m.id), passages);
    for (const claim of built.claims) {
      claims++;
      const source = built.sources.find((s) => s.id === claim.sourceId)!;
      const retained = passages(claim.sourceId)!;
      assert.equal(source.text, retained.text, `${m.id} ${claim.sourceId} is the retained passage`);
      assert.equal(source.hash, sha256(retained.text));
      assert.ok(source.text.includes(claim.quote), `${m.id}: ${claim.locator}`);
      assert.ok(claimLocatorMatches(source.text, claim.quote, claim.locator), `${m.id}: ${claim.locator}`);
      assert.ok(
        m.sentences.some((s) => s.text === claim.text),
        `${m.id}: a claim is one of its sentences`,
      );
      for (const n of claim.numbers) assert.ok(claim.quote.includes(n), `${m.id}: ${n} is in the quotation`);
    }
    // No source decision has been made on any of them.
    for (const s of built.sources) {
      assert.equal(s.status, "held", `${m.id} ${s.id}`);
      assert.equal(s.operativeTextConfirmed, false);
      assert.equal(s.amendmentsResolved, false);
    }
  }
  assert.ok(claims > 100, `${claims} claims are bound across the ten guides`);
});

test("a statutory number in a guide is in the words quoted for it", async () => {
  // The four intervals the drafts state, each read from the quotation and not from the map.
  for (const [id, start, number] of [
    ["GUD-04", "The statute requires notification to the Registrar within 28 days", "28"],
    ["GUD-05", "Section 822 states 30 June", "30"],
    ["GUD-07", "Subject to directions under the relevant winding-up rules", "six"],
    ["GUD-10", "Section 31 states a minimum retention period of six years", "six"],
  ] as const) {
    const built = buildGuideClaims(map(id), await body(id), passages);
    const claim = built.claims.find((c) => c.text.startsWith(start))!;
    assert.ok(statedNumbers(claim.text).includes(number), `${id} states ${number}`);
    assert.ok(new RegExp(`\\b${number}`, "i").test(claim.quote), `${id}: ${number} is quoted`);
  }
  // A run of digits is a stated number; a number in words is one only before a unit of time or money.
  assert.deepEqual(statedNumbers("within 28 days, or six years, of 1 January 2026; two partners"), [
    "28",
    "1",
    "2026",
    "six",
  ]);
});

test("the build refuses a map that leaves words out, changes them, or quotes what is not there", async () => {
  const gud04 = await body("GUD-04");
  const build = (m: GuideClaimMap) => () => buildGuideClaims(m, gud04, passages);

  // A sentence left out: the next one is not where the map says it is.
  const m = map("GUD-04");
  assert.throws(
    build({ ...m, sentences: m.sentences.filter((_, i) => i !== 3) }),
    /GUIDE_CLAIM_MAP_SENTENCE:GUD-04/,
  );
  // The last sentence left out: words remain that the map never placed.
  assert.throws(build({ ...m, sentences: m.sentences.slice(0, -1) }), /GUIDE_CLAIM_MAP_INCOMPLETE:GUD-04/);
  // One word changed.
  const within = indexOf("GUD-04", "The statute requires notification");
  assert.throws(
    build(changed("GUD-04", within, (s) => ({ ...s, text: s.text.replace("28 days", "30 days") }))),
    /GUIDE_CLAIM_MAP_SENTENCE:GUD-04/,
  );
  // A sentence about the law with nothing to rest on.
  assert.throws(
    build(changed("GUD-04", within, (s) => ({ kind: "source_statement", text: s.text, support: [] }))),
    /GUIDE_CLAIM_MAP_UNSUPPORTED:GUD-04/,
  );
  // A quotation whose first words are not in the passage, and one whose first words occur twice.
  const support = (from: string, to: string, locator = "section 818(1), printed page A409") => [
    { passage: "CAMA-818", from, to, locator },
  ];
  assert.throws(
    build(
      changed("GUD-04", within, (s) => ({
        kind: "source_statement",
        text: s.text,
        support: support("within 21 days after", "registrar."),
      })),
    ),
    /GUIDE_CLAIM_QUOTE_ANCHOR:GUD-04:CAMA-818/,
  );
  assert.throws(
    build(
      changed("GUD-04", within, (s) => ({
        kind: "source_statement",
        text: s.text,
        support: support("individual, firm or", "registrar."),
      })),
    ),
    /GUIDE_CLAIM_QUOTE_ANCHOR:GUD-04:CAMA-818/,
  );
  // The 28 days rest on words that do not say 28.
  assert.throws(
    build(
      changed("GUD-04", within, (s) => ({
        kind: "source_statement",
        text: s.text,
        support: support("other than particulars as to the age", "of an individual"),
      })),
    ),
    /GUIDE_CLAIM_NUMBER_UNSUPPORTED:GUD-04:28/,
  );
  // The same words, called a practical suggestion: a number still needs a quotation.
  assert.throws(
    build(changed("GUD-04", within, (s) => ({ kind: "optional_practice", text: s.text }))),
    /GUIDE_CLAIM_NUMBER_UNSUPPORTED:GUD-04:28/,
  );
  // A section the passage is not, and a printed page it was not extracted from.
  for (const locator of ["section 819(1), printed page A409", "section 818(1), printed page A410"])
    assert.throws(
      build(
        changed("GUD-04", within, (s) => ({
          kind: "source_statement",
          text: s.text,
          support: support(
            "the individual, firm or corporation shall within 28 days after",
            "registrar.",
            locator,
          ),
        })),
      ),
      /GUIDE_CLAIM_LOCATOR:GUD-04:CAMA-818/,
    );
});

test("a number that is Valo's own record is named with its reason, and nothing else is let through", async () => {
  const gud05 = await body("GUD-05"),
    m = map("GUD-05");
  assert.deepEqual(
    m.ownNumbers?.map((o) => o.text),
    ["14 November 2026"],
  );
  // The notice sentence rests on a page that is not retained, so it is reported, not bound.
  const built = buildGuideClaims(m, gud05, passages);
  assert.equal(built.missingEvidence.length, 1);
  assert.match(built.missingEvidence[0]!, /CAC-PORTAL-NOTICE is not among the passages supplied/);
  assert.ok(!built.claims.some((c) => c.text.startsWith("Its notice checked on")));

  // Supplied with the notice as the portal showed it, the sentence is bound and its 2025 is checked.
  const notice =
    "Annual Returns for Business Names\nFiling of annual returns is now available for all business names registered before July 2025. Because we are currently upgrading the business name system with new AI features, a new AI-powered annual returns process will be introduced soon.";
  const page: GuidePassage = {
    id: "CAC-PORTAL-NOTICE",
    recordedLocator: "Company Registration Portal home page, public notice",
    text: notice,
    hash: sha256(notice),
    sections: [],
    instrument: {
      id: "CAC-ICRP",
      kind: "official_page",
      url: "https://icrp.cac.gov.ng/",
      rawSha256: null,
      title: "Corporate Affairs Commission: Company Registration Portal",
      issuingBody: "Corporate Affairs Commission",
      retrievedAt: "2026-11-21T17:55:00.000Z",
      effectiveFrom: "2026-11-21T17:55:00.000Z",
    },
  };
  const withPage = buildGuideClaims(m, gud05, (id) => (id === page.id ? page : passages(id)));
  assert.deepEqual(withPage.missingEvidence, []);
  const bound = withPage.claims.find((c) => c.text.startsWith("Its notice checked on"))!;
  assert.deepEqual(bound.numbers, ["2025"]);
  // Without the reason on record, the day Valo read the page would have to be in the notice.
  assert.throws(
    () => buildGuideClaims({ ...m, ownNumbers: [] }, gud05, (id) => (id === page.id ? page : passages(id))),
    /GUIDE_CLAIM_NUMBER_UNSUPPORTED:GUD-05:14,2026/,
  );
  // And a page that says another year does not bear the sentence out.
  const other = { ...page, text: notice.replace("July 2025", "July 2024") };
  other.hash = sha256(other.text);
  assert.throws(
    () => buildGuideClaims(m, gud05, (id) => (id === page.id ? other : passages(id))),
    /GUIDE_CLAIM_NUMBER_UNSUPPORTED:GUD-05:2025/,
  );
});

test("a guide built from its map is a held candidate that says what it lacks", async () => {
  // A fixed day: what a source's amendment record supports depends on how old its searches are.
  const day = new Date("2026-11-21T20:00:00Z");
  const unboundLine = /is not among the passages supplied/,
    notCurrentLine = /is not marked current: /;
  for (const id of mappedGuideIds) {
    const built = await buildGuideCandidate(id, 1, passages, day);
    const c = publicationSchema.shape.candidate.parse(built.candidate);
    publicationSchema.shape.sources.parse(built.sources);
    assert.equal(c.hash, candidateDigest(c), id);
    assert.equal(c.contentClass, "sourced_guidance");
    assert.notEqual(c.risk, "general", `${id} takes the enhanced checks`);
    assert.equal(c.legalScopeStatus, "unverified", id);
    assert.equal(c.scope, GUIDE_SCOPE);
    assert.equal(c.limitations, GUIDE_LIMITATIONS);
    // Every line of missing evidence is a sentence left unbound or a source not marked current,
    // and each source that is held has its line.
    for (const line of c.missingEvidence)
      assert.ok(unboundLine.test(line) || notCurrentLine.test(line), `${id}: ${line}`);
    const held = built.sources.filter((s) => s.status !== "approved");
    assert.ok(held.length > 0, `${id} has a source that is not marked current`);
    assert.equal(c.missingEvidence.filter((line) => notCurrentLine.test(line)).length, held.length, id);
    for (const s of built.sources)
      assert.equal(s.status === "approved", s.operativeTextConfirmed && s.amendmentsResolved, s.id);
    assert.equal(c.assumptions.length, 1, `${id} carries its draft's own applicability note`);
    assert.match(c.assumptions[0]!, /^Applies when: /);
    // Its sources were last read on 14 November 2026, and it says so; it is due again in 30 days.
    assert.match(c.sourceCheckDate, /^2026-11-14T/);
    assert.equal(Date.parse(c.reviewBy!) - Date.parse(c.sourceCheckDate), 30 * 86_400_000);
    // A guide's links go only to hosts the proposed guidance policy lists.
    for (const host of built.linkHosts)
      assert.ok((guidanceOfficialHosts as readonly string[]).includes(host), `${id} links to ${host}`);

    // In a bundle it is held, for the reasons the gate gives a guide with no source decision.
    const bundle: PublicationBundle = {
      ...heldSourceBundle(new Date(c.sourceCheckDate)),
      candidate: c,
      sources: built.sources,
    };
    const decision = evaluatePublication(bundle, new Date(Date.parse(c.sourceCheckDate) + 86_400_000));
    assert.equal(decision.decision, "hold", id);
    for (const reason of ["legal_scope_unverified", "material_uncertainty", "rights_not_cleared"])
      assert.ok(decision.reasons.includes(reason), `${id}: ${reason}`);
    assert.ok(
      decision.reasons.some((r) => r.startsWith("source_unresolved:")),
      id,
    );
    // No claim is an unsupported one: what holds the guide is the evidence it still lacks.
    assert.ok(!decision.reasons.some((r) => /^unsupported_(claim|number)/.test(r)), id);
  }
  // The two guides that rest on pages not kept in the repository name the sentences left unbound.
  const unbound = async (id: string) =>
    (await buildGuideCandidate(id, 1, passages, day)).candidate.missingEvidence.filter((line) =>
      unboundLine.test(line),
    ).length;
  assert.equal(await unbound("GUD-05"), 1);
  assert.equal(await unbound("GUD-08"), 3);
  assert.equal(await unbound("GUD-01"), 0);
  await assert.rejects(() => buildGuideCandidate("GUD-11"), /GUIDE_CLAIM_MAP_MISSING:GUD-11/);
});

test("the guide page shows a built guide's own words and its sources, not its document", async () => {
  const built = await buildGuideCandidate("GUD-01");
  const bundle: PublicationBundle = {
    ...heldSourceBundle(new Date(built.candidate.sourceCheckDate)),
    candidate: built.candidate,
    sources: built.sources,
  };
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "gud-01",
    bundle,
  } as unknown as typeof valoContentVersions.$inferSelect;
  const page = projectReleasedResource(row);
  assert.equal(page.title, "Check the name you trade under");
  assert.equal(page.kind, "guidance");
  // The body is the guide's four paragraphs, as text.
  const own = guideOwnBlocks(built.document.content.blocks);
  assert.equal(page.body, own.map((b) => b.text).join("\n\n"));
  assert.equal(page.body.split("\n\n").length, 4);
  assert.ok(page.body.startsWith("Business-name registration depends on the operator"));
  assert.ok(page.summary.startsWith("Business-name registration depends on the operator"));
  for (const not of ['{"title"', "guide-covers", "What it covers", "Sources checked", "](http"])
    assert.ok(!page.body.includes(not), `the body has no "${not}"`);
  assert.equal(page.scope, GUIDE_SCOPE);
  assert.equal(page.limitations, GUIDE_LIMITATIONS);
  assert.equal(page.reviewedAt, built.candidate.sourceCheckDate);

  // Each place a claim points to is listed once, under the official text's own name.
  assert.ok(page.sources.length >= 8);
  assert.equal(new Set(page.sources.map((s) => `${s.url} ${s.locator}`)).size, page.sources.length);
  assert.ok(
    page.sources.some(
      (s) =>
        s.title === "Companies and Allied Matters Act 2020" &&
        s.locator === "section 814(1), printed page A405" &&
        s.url === "https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf",
    ),
  );
  // A place given as words of the text is shown as those words.
  assert.ok(page.sources.some((s) => s.locator === "the words: “surname” includes a patronymic"));
  assert.ok(!page.sources.some((s) => s.locator.startsWith("heading:")));
  // The file's list groups those places under two official texts.
  const lines = guideSourceLines(page.sources);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^Companies and Allied Matters Act 2020: section 814\(1\), printed page A405; /);
  assert.match(
    lines[1]!,
    /^Corporate Affairs Commission: business name registration page: .*https:\/\/www\.cac\.gov\.ng\/services\/business-name$/,
  );

  // A body that is not a guide's document is shown as the text it is, as before.
  const plain = projectReleasedResource({
    id: "00000000-0000-4000-8000-000000000002",
    slug: "controlled-fixture",
    bundle: heldSourceBundle(new Date()),
  } as unknown as typeof valoContentVersions.$inferSelect);
  assert.equal(plain.body, "Controlled boundary fixture only");
  assert.equal(plain.title, "Controlled boundary fixture only");
});
