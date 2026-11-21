import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { guideAmendmentRecords } from "./guidance-amendments";
import { mappedGuideIds } from "./guidance-bundle";
import { assembledGuide } from "./guidance-release.fixtures";
import { guideAmendmentBasis, guideReviewInputs } from "./guidance-review-inputs";

const day = new Date("2026-11-22T08:00:00Z");
const record = (instrument: string) => guideAmendmentRecords.find((r) => r.instrument === instrument)!;
const hex64 = /[a-f0-9]{64}/;

/** The review inputs of a guide as the readiness check makes them, from a bundle put together on `day`. */
async function inputsFor(id: string) {
  const guide = await assembledGuide(id, day);
  const { evidence: _withThePermissions, ...permissionScope } = guide.applicability.record;
  return {
    guide,
    ...guideReviewInputs({
      provenance: guide.built.provenance,
      originalText: guide.built.original,
      rebuiltBody: JSON.stringify(guide.built.document),
      candidateBody: guide.bundle.candidate.body,
      rights: guide.rights,
      permissionScope,
      claimScope: guide.built.claimScope,
    }),
  };
}

test("the reviewers are given an Act's amendment record as it bears on the sections the guide quotes", async () => {
  const { guide, provenanceInput } = await inputsFor("GUD-01");
  // GUD-01 quotes one Act and one official page; a page has no amendment record.
  assert.equal(provenanceInput.amendmentBasis.length, 1);
  const basis = provenanceInput.amendmentBasis[0]!;
  const cama = record("CAC-CAMA-2020");
  assert.equal(basis.text, cama.title);
  assert.equal(basis.url, cama.url);
  assert.deepEqual(basis.commencement, {
    asThisCopyPrintsIt: cama.commencement.printed,
    treatedAsInForceFrom: cama.commencement.effectiveFrom,
  });
  assert.deepEqual(basis.sectionsQuoted, ["814", "863", "868"]);
  assert.deepEqual(
    basis.sectionsQuoted,
    [...new Set(guide.built.claimScope.passages.flatMap((p) => p.sections))].sort((a, b) => +a - +b),
  );

  // Every place searched, with what was found there and the day; nothing searched is left out.
  assert.deepEqual(
    basis.searched,
    cama.searches.map((s) => ({ place: s.place, url: s.url, on: s.searchedAt.slice(0, 10), found: s.found })),
  );
  // Every amending instrument, with the number of every section it changes. Its own words are
  // given for the sections this guide quotes and for no other.
  assert.deepEqual(
    basis.amendingInstruments.map((a) => [a.title, a.sectionsItChanges]),
    cama.amendments.map((a) => [a.title, Object.keys(a.sections)]),
  );
  const facilitation = basis.amendingInstruments.find((a) => /Business Facilitation/.test(a.title))!;
  assert.equal(facilitation.sectionsItChanges.length, 20);
  assert.deepEqual(facilitation.onSectionsQuoted, {
    "868": cama.amendments.find((a) => /Business Facilitation/.test(a.title))!.sections["868"],
  });
  const finance = basis.amendingInstruments.find((a) => /Finance Act/.test(a.title))!;
  assert.deepEqual(finance.sectionsItChanges, ["432"]);
  assert.deepEqual(finance.onSectionsQuoted, {});
  // What the record says it does not cover is given whole.
  assert.equal(basis.limits, cama.limits);
  assert.deepEqual(basis.notRead, cama.notRead);
  // Checksums are left out: a reviewer cannot use them, and the record keeps them.
  assert.doesNotMatch(JSON.stringify(basis), hex64);
});

test("differences between official copies are given for the sections quoted, and an open question always", async () => {
  const { guide, provenanceInput } = await inputsFor("GUD-08");
  const ntaa = record("NASS-NTAA-2025");
  const basis = provenanceInput.amendmentBasis.find((b) => b.text === ntaa.title)!;
  assert.deepEqual(basis.sectionsQuoted, ["4", "7", "147"]);
  const quoted = new Set(basis.sectionsQuoted);
  // The comparisons made between the two official copies, for the sections quoted and no other.
  assert.deepEqual(
    Object.keys(basis.copiesCompared!).sort(),
    Object.keys(ntaa.comparedSections!)
      .filter((section) => quoted.has(section))
      .sort(),
  );
  // The open question about the day the Act commenced names section 148, which no guide quotes.
  // It is given all the same: it bears on every statement about when the Act applies.
  assert.ok(!quoted.has("148"));
  const open = basis.differencesAndOpenQuestions.filter((c) => c.open);
  assert.deepEqual(
    open,
    ntaa.conflicts.filter((c) => c.open),
  );
  assert.equal(open.length, 1);
  assert.match(open[0]!.about, /commenced/);
  // A settled difference is given only where it touches a section quoted.
  for (const difference of basis.differencesAndOpenQuestions.filter((c) => !c.open))
    assert.ok(difference.sections === "all" || difference.sections.some((s) => quoted.has(s)));

  // Asked directly. No passage of an Act: nothing to give. And an instrument a record lists as not
  // yet read is passed on (the instrument here is made up for this test).
  assert.deepEqual(guideAmendmentBasis([]), []);
  const unread = [{ title: "A later Act, made up for this test", why: "it could amend the text" }];
  const supposed = guideAmendmentBasis(guide.built.claimScope.passages, [{ ...ntaa, notRead: unread }]);
  assert.deepEqual(supposed[0]!.notRead, unread);
});

test("the rights and provenance parts say what was measured and what was confirmed", async () => {
  const { guide, rightsInput, provenanceInput } = await inputsFor("GUD-01");
  assert.equal(rightsInput.customerLicenceAccepted, false);
  assert.deepEqual(rightsInput.permissions, guide.rights.permissions);
  assert.equal(rightsInput.officialText.limitWords, 20);
  assert.equal(rightsInput.officialText.longestSharedWords, guide.rights.officialText.longestSharedWords);
  // The measure for each passage, without the checksum the sources already carry.
  assert.deepEqual(
    rightsInput.officialText.measured,
    guide.rights.officialText.measured.map(({ sourceId, sharedWords }) => ({ sourceId, sharedWords })),
  );
  assert.equal(provenanceInput.originalItemSha256, sha256(guide.built.original));
  assert.match(provenanceInput.originalItem, /^Not sent again/);
  assert.equal(provenanceInput.claimScope.sentences, guide.built.claimScope.sentences);
  assert.equal(provenanceInput.upstreamModelAndRunNotRecorded, true);

  // The draft is not sent, so the inputs are refused unless the body is the draft's words built again.
  assert.throws(
    () =>
      guideReviewInputs({
        provenance: guide.built.provenance,
        originalText: guide.built.original,
        rebuiltBody: JSON.stringify(guide.built.document),
        candidateBody: guide.bundle.candidate.body.replace("Check the name", "Check a name"),
        rights: guide.rights,
        permissionScope: {},
        claimScope: guide.built.claimScope,
      }),
    /SAVED_BODY_NOT_EXACT_CURRENT_INTAKE/,
  );
});

test("every mapped guide's review inputs can be made, and none carries a reviewer's verdict", async () => {
  for (const id of mappedGuideIds) {
    const { rightsInput, provenanceInput } = await inputsFor(id);
    const sent = JSON.stringify({ rightsInput, provenanceInput });
    assert.doesNotMatch(sent, /"(?:verdict|reviews|otherReview|reviewerVerdict)"/, id);
    for (const basis of provenanceInput.amendmentBasis) {
      assert.ok(basis.sectionsQuoted.length > 0, `${id} ${basis.text}`);
      assert.ok(basis.searched.length > 0 && basis.limits.length > 0, `${id} ${basis.text}`);
    }
  }
});
