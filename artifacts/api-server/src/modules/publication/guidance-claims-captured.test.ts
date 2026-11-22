import test from "node:test";
import assert from "node:assert/strict";
import { allSourceLeads } from "@workspace/valo-core";
import { guideAmendmentRecords, guideSourceDecision } from "./guidance-amendments";
import {
  buildGuideCandidate,
  guideClaimMaps,
  guidePassageIds,
  mappedGuideIds,
  repositoryBuiltGuideIds,
} from "./guidance-bundle";
import { capturedPassages, capturedTexts } from "./guidance-captured-texts";
import { passageLead } from "./guidance-captures";
import { buildGuideClaims, type GuideClaimMap } from "./guidance-claim-map";
import { employmentClaimMaps } from "./guidance-claims-employment";
import { foodClaimMaps } from "./guidance-claims-food";
import { privacyClaimMaps } from "./guidance-claims-privacy";
import { guideBodyBlocks } from "./guidance-document";
import { retainedGuidePassages, type GuidePassage } from "./guidance-passages";
import { guidanceOfficialHosts } from "./guidance-policy";
import { readGuidanceIntake } from "./operational-intake";

/**
 * The guides whose official texts are not kept in the repository.
 *
 * These tests have no official words to read, so they cannot show that a quotation is in its
 * passage. They show what can be shown without them: every word of each guide is placed, every
 * sentence about the law names a recorded passage, and every recorded passage belongs to a known
 * official address with an amendment record. Whether the quotations are in the official text is
 * checked when a guide is prepared from a capture, which fails closed.
 */
const capturedMaps = guideClaimMaps.filter((m) => !repositoryBuiltGuideIds.includes(m.id));
const body = async (id: string) => (await readGuidanceIntake(id)).section.body;
const supports = (m: (typeof capturedMaps)[number]) =>
  m.sentences.flatMap((s) => ("support" in s ? (s.support ?? []) : []));

/** Every word of each guide is placed, and each sentence about the law names something to rest on. */
async function placesEverySentence(maps: readonly GuideClaimMap[], risk: GuideClaimMap["risk"]) {
  for (const m of maps) {
    assert.equal(m.risk, risk, m.id);
    const text = guideBodyBlocks(m.id, await body(m.id))
      .map((b) => b.text)
      .join("\n");
    // Put back together, the map's sentences are the guide's words, with nothing left over.
    assert.equal(m.sentences.map((s) => s.text).join(" "), text.replace(/\n/g, " "), m.id);
    // With no passage supplied the map still builds: every sentence is classified, and each
    // sentence about the law is reported as not bound, once for each passage it rests on.
    const built = buildGuideClaims(m, await body(m.id), () => undefined);
    assert.equal(built.scope.sentences, m.sentences.length, m.id);
    assert.equal(
      Object.values(built.scope.byKind).reduce((a, b) => a + b, 0),
      m.sentences.length,
      m.id,
    );
    assert.ok(built.scope.byKind.source_statement >= 1, `${m.id} states what a source says`);
    assert.deepEqual(built.claims, []);
    assert.deepEqual(built.sources, []);
    assert.equal(built.missingEvidence.length, supports(m).length, m.id);
    assert.ok(built.missingEvidence.every((line) => /is not among the passages supplied/.test(line)));
    // A sentence about the law always rests on something.
    for (const s of m.sentences)
      if (s.kind === "source_statement" || s.kind === "interpretation") assert.ok(s.support.length, s.text);
  }
}

test("the five privacy guides are mapped, and each map places every sentence of its guide", async () => {
  assert.deepEqual(
    privacyClaimMaps.map((m) => m.id),
    ["GUD-11", "GUD-12", "GUD-13", "GUD-14", "GUD-15"],
  );
  await placesEverySentence(privacyClaimMaps, "privacy");
  // Each privacy guide says what the Act or the directive says at least three times.
  for (const m of privacyClaimMaps)
    assert.ok(m.sentences.filter((s) => s.kind === "source_statement").length >= 3, m.id);
});

test("the eight food guides are mapped, and each map places every sentence of its guide", async () => {
  assert.deepEqual(
    foodClaimMaps.map((m) => m.id),
    ["GUD-19", "GUD-20", "GUD-21", "GUD-22", "GUD-23", "GUD-24", "GUD-25", "GUD-26"],
  );
  await placesEverySentence(foodClaimMaps, "regulated_sector");
  // Most of what these guides say is a way of working, not a statement about the law.
  for (const m of foodClaimMaps)
    assert.ok(
      m.sentences.filter((s) => s.kind === "optional_practice").length > m.sentences.length / 2,
      m.id,
    );
});

test("the four employment guides are mapped, and each map places every sentence of its guide", async () => {
  assert.deepEqual(
    employmentClaimMaps.map((m) => m.id),
    ["GUD-27", "GUD-28", "GUD-29", "GUD-30"],
  );
  await placesEverySentence(employmentClaimMaps, "employment");
  for (const m of employmentClaimMaps) {
    // Each of these guides says what the Labour Act says once, and reads it more than once.
    assert.equal(m.sentences.filter((s) => s.kind === "source_statement").length, 1, m.id);
    assert.ok(m.sentences.filter((s) => s.kind === "interpretation").length >= 2, m.id);
    // All they rest on is the one copy of the Labour Act.
    assert.ok(
      supports(m).every((s) => s.passage.startsWith("LABOUR-")),
      m.id,
    );
  }
});

test("these are all the guides whose texts are not kept in the repository", () => {
  assert.deepEqual(
    capturedMaps.map((m) => m.id),
    [...privacyClaimMaps, ...foodClaimMaps, ...employmentClaimMaps].map((m) => m.id),
  );
  assert.equal(mappedGuideIds.length, repositoryBuiltGuideIds.length + capturedMaps.length);
});

test("every passage these guides name is recorded with its place and checksum, and nothing else is recorded", () => {
  const named = new Set(capturedMaps.flatMap((m) => supports(m).map((s) => s.passage)));
  assert.deepEqual([...named].sort(), capturedPassages.map((p) => p.id).sort());
  assert.equal(new Set(capturedPassages.map((p) => p.id)).size, capturedPassages.length);
  const retained = retainedGuidePassages();
  for (const p of capturedPassages) {
    assert.match(p.sha256, /^[a-f0-9]{64}$/, p.id);
    assert.ok(p.from.trim().length >= 8 && p.to.trim().length >= 8, `${p.id} names where it starts and ends`);
    assert.ok(p.recordedLocator.trim(), p.id);
    assert.equal(retained(p.id), undefined, `${p.id} is not also kept in the repository`);
    const text = capturedTexts.find((t) => t.id === p.text);
    assert.ok(text, `${p.id} belongs to a recorded text`);
    // A passage of an Act names its section, and starts at the section's number: a locator that
    // names the section is checked against the passage's first words. Two kinds of passage start
    // elsewhere: a definition, which starts at the term defined, and a passage of a section whose
    // heading this copy numbers wrongly, which its text's record must say.
    if (text.kind === "act" && !/^[“"]/.test(p.from)) {
      assert.equal(p.sections.length, 1, p.id);
      const section = p.sections[0]!;
      const misnumbered = guideAmendmentRecords
        .find((r) => r.instrument === text.id)
        ?.conflicts.some(
          (c) =>
            /numbers some headings/.test(c.about) && c.sections !== "all" && c.sections.includes(section),
        );
      if (misnumbered) assert.ok(!/^\d/.test(p.from), `${p.id} is placed by its heading's words`);
      else assert.ok(p.from.startsWith(`${section}.`), p.id);
    }
    assert.equal(passageLead(p.id, retained), text.leadId);
  }
  for (const m of capturedMaps) {
    assert.deepEqual(
      guidePassageIds(m.id).sort(),
      [...new Set(supports(m).map((s) => s.passage))].sort(),
      m.id,
    );
  }
  assert.throws(() => guidePassageIds("GUD-99"), /GUIDE_CLAIM_MAP_MISSING:GUD-99/);
});

test("each text read only from captures is at a known official address and has an amendment record", () => {
  assert.equal(new Set(capturedTexts.map((t) => t.id)).size, capturedTexts.length);
  for (const text of capturedTexts) {
    const leads = allSourceLeads.filter((lead) => lead.id === text.leadId);
    assert.equal(leads.length, 1, text.id);
    const url = new URL(leads[0]!.url);
    assert.equal(url.protocol, "https:");
    assert.ok((guidanceOfficialHosts as readonly string[]).includes(url.hostname), text.id);
    assert.ok(Date.parse(text.effectiveFrom) < Date.parse("2026-11-21T00:00:00Z"), text.id);
    assert.equal(guideAmendmentRecords.filter((r) => r.instrument === text.id).length, 1, text.id);
    assert.ok(
      capturedPassages.some((p) => p.text === text.id),
      `${text.id} has a passage`,
    );
  }
});

test("the Labour Act is read from a reference copy, so every passage of it is held", () => {
  const text = capturedTexts.find((t) => t.id === "NIPC-LABOUR-ACT")!;
  const record = guideAmendmentRecords.find((r) => r.instrument === text.id)!;
  // The record is of the copy at the lead's address, and it says what the publisher says of it.
  assert.equal(record.url, allSourceLeads.find((l) => l.id === text.leadId)!.url);
  assert.match(record.searches[0]!.found, /The authoritative version remains with the issuing authority/);
  assert.deepEqual(
    record.conflicts.filter((c) => c.open).map((c) => [c.about, c.sections, c.aboutTheCopy]),
    [["whether this copy can stand for the Act", "all", true]],
  );
  assert.deepEqual(
    record.notRead.map((unread) => unread.title),
    ["Trade Union (Amendment) Act 2005"],
  );
  // Whatever words a capture of that very file supplies, no passage of this copy is marked current,
  // and none is confirmed as the Act's operative text.
  const passagesOfIt = capturedPassages.filter((p) => p.text === text.id);
  assert.equal(passagesOfIt.length, 5);
  for (const p of passagesOfIt) {
    const supplied: GuidePassage = {
      id: p.id,
      recordedLocator: p.recordedLocator,
      text: "Stand-in words: the official words are not kept in the repository.",
      hash: p.sha256,
      sections: [...p.sections],
      instrument: {
        id: text.id,
        kind: text.kind,
        url: record.url,
        rawSha256: record.rawSha256,
        title: text.title,
        issuingBody: text.issuingBody,
        retrievedAt: "2026-11-22T08:00:00.000Z",
        effectiveFrom: text.effectiveFrom,
      },
    };
    const decision = guideSourceDecision(supplied, new Date("2026-11-22T08:00:00Z"));
    assert.deepEqual(
      [decision.status, decision.operativeTextConfirmed, decision.amendmentsResolved],
      ["held", false, false],
      p.id,
    );
    assert.deepEqual(
      decision.reasons,
      [
        "an open question touches this passage: whether this copy can stand for the Act",
        `not yet read, and able to amend this text: Trade Union (Amendment) Act 2005 (${record.notRead[0]!.why})`,
      ],
      p.id,
    );
  }
  // No other text read from captures has an open question or anything left unread.
  for (const other of guideAmendmentRecords) {
    if (other.instrument === text.id || !capturedTexts.some((t) => t.id === other.instrument)) continue;
    assert.deepEqual(other.notRead, [], other.instrument);
    assert.ok(
      other.conflicts.every((c) => !c.open),
      other.instrument,
    );
  }
});

test("without a capture, a guide whose texts are not kept in the repository cannot be built", async () => {
  for (const m of capturedMaps)
    await assert.rejects(buildGuideCandidate(m.id), new RegExp(`GUIDE_HAS_NO_BOUND_SOURCE:${m.id}`));
});
