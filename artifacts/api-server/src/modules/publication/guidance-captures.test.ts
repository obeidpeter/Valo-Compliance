import test from "node:test";
import assert from "node:assert/strict";
import { allSourceLeads, sha256 } from "@workspace/valo-core";
import { guideAmendmentRecords } from "./guidance-amendments";
import { buildGuideCandidate, guideClaimMaps } from "./guidance-bundle";
import {
  capturedGuidePassages,
  cutCapturedPassage,
  guideActLeads,
  guideCaptureLeads,
  guideSourceSnapshots,
  passageLead,
  type CapturedRecords,
  type GuideCapture,
} from "./guidance-captures";
import { retainedGuidePassages } from "./guidance-passages";

// What-if captures: none of these was fetched. Each is made from the passages kept in the
// repository, set out as the daily check would hold a capture of the same address.
const day = new Date("2026-11-22T08:00:00Z");
const checkedAt = "2026-11-22T07:00:00.000Z";
const retained = retainedGuidePassages();
const actRawChecksum = (instrument: string) =>
  guideAmendmentRecords.find((record) => record.instrument === instrument)!.rawSha256;
const lead = (id: string) => allSourceLeads.find((l) => l.id === id)!;

/** A capture of an Act's address holding the passages named, with the checksum its record describes. */
function actCapture(instrument: string, passageIds: readonly string[], extra = ""): GuideCapture {
  const leadId = guideActLeads[instrument]!;
  return {
    leadId,
    url: lead(leadId).url,
    snapshotId: `00000000-0000-4000-8000-${leadId
      .replace(/[^a-z0-9]/gi, "")
      .padStart(12, "0")
      .slice(-12)}`,
    checkedAt,
    rawChecksum: actRawChecksum(instrument),
    text: ["cover page", ...passageIds.map((id) => retained(id)!.text), extra].join("\n\f\n"),
  };
}
const pageCapture = (leadId: string, text: string): GuideCapture => ({
  leadId,
  url: lead(leadId).url,
  snapshotId: `11111111-1111-4111-8111-${leadId
    .replace(/[^a-z0-9]/gi, "")
    .padStart(12, "0")
    .slice(-12)}`,
  checkedAt,
  rawChecksum: sha256(`page file of ${leadId}`),
  text,
});

test("each address a guide's passages are read from is a known official source", () => {
  assert.deepEqual([...guideCaptureLeads].sort(), [
    "CAC-BN-PROCESS",
    "NAFDAC-FRR-GDL-003-01",
    "NAFDAC-FRRA-GDL-002-01",
    "NAFDAC-FSAN-GDL-001-03",
    "NAFDAC-FSAN-GDL-004-03",
    "NAFDAC-FSAN-GDL-005-03",
    "NAFDAC-FSAN-GDL-006-03",
    "NAFDAC-FSAN-GDL-008-03",
    "NAFDAC-IE-GDL-001-02",
    "NASS-NTAA-2025",
    "NRS-TAXID-HOW",
    "S03",
    "S04",
    "S05",
    "SV-010",
  ]);
  for (const id of guideCaptureLeads) {
    const known = allSourceLeads.filter((l) => l.id === id);
    assert.equal(known.length, 1, id);
    assert.match(known[0]!.url, /^https:\/\//);
  }
  // The address of each Act's lead is the address its retained passages were read from, which is
  // the one its amendment record describes. A release binds a source to its lead by that address.
  for (const [instrument, leadId] of Object.entries(guideActLeads)) {
    const record = guideAmendmentRecords.find((r) => r.instrument === instrument)!;
    assert.equal(lead(leadId).url, record.url, instrument);
  }
  assert.equal(retained("CAMA-814")!.instrument.url, lead("SV-010").url);
  assert.equal(retained("NTAA-4")!.instrument.url, lead("NASS-NTAA-2025").url);
  assert.equal(retained("CAC-BN-PROCESS")!.instrument.url, lead("CAC-BN-PROCESS").url);
});

test("a passage of an Act is supplied only when today's capture of the Act holds it word for word", () => {
  const capture = actCapture("CAC-CAMA-2020", ["CAMA-814", "CAMA-863"]);
  const passages = capturedGuidePassages([capture]);

  const found = passages("CAMA-814")!;
  const kept = retained("CAMA-814")!;
  assert.equal(found.text, kept.text);
  assert.equal(found.hash, kept.hash);
  assert.deepEqual(found.sections, ["814"]);
  // Dated and checksummed from the capture, not from the copy kept in the repository.
  assert.equal(found.instrument.retrievedAt, checkedAt);
  assert.equal(found.instrument.rawSha256, capture.rawChecksum);
  assert.equal(found.instrument.effectiveFrom, kept.instrument.effectiveFrom);

  // Not in the capture: not supplied, whatever the repository keeps.
  assert.ok(retained("CAMA-868-forename"));
  assert.equal(passages("CAMA-868-forename"), undefined);
  // One changed character in the captured text is enough.
  const changed = { ...capture, text: capture.text.replace("Every individual", "Every  individual") };
  assert.notEqual(changed.text, capture.text);
  assert.equal(capturedGuidePassages([changed])("CAMA-814"), undefined);
  assert.ok(capturedGuidePassages([changed])("CAMA-863"));
  // A capture of another address, or no capture of the Act at all.
  assert.equal(
    capturedGuidePassages([{ ...capture, url: "https://icrp.cac.gov.ng/" }])("CAMA-814"),
    undefined,
  );
  assert.equal(capturedGuidePassages([])("CAMA-814"), undefined);
  // The other Act's passages need the other Act's capture.
  assert.equal(passages("NTAA-4"), undefined);
  assert.ok(capturedGuidePassages([actCapture("NASS-NTAA-2025", ["NTAA-4"])])("NTAA-4"));
  assert.equal(passages("NO-SUCH-PASSAGE"), undefined);
});

test("a page's passage is the page as captured", () => {
  const notice =
    "\n  Annual Returns for Business Names\nFiling of annual returns is now available for all business names registered before July 2025. Because we are currently upgrading the business name system with new AI features, a new AI-powered annual returns process will be introduced soon.\n";
  const capture = pageCapture("S03", notice);
  const page = capturedGuidePassages([capture])("CAC-PORTAL-NOTICE")!;
  assert.equal(page.text, notice.trim());
  assert.equal(page.hash, sha256(notice.trim()));
  assert.deepEqual(page.sections, []);
  assert.equal(page.instrument.kind, "official_page");
  assert.equal(page.instrument.url, "https://icrp.cac.gov.ng/");
  assert.equal(page.instrument.rawSha256, capture.rawChecksum);
  // A page is known to say this from the time it was read, and no earlier.
  assert.equal(page.instrument.retrievedAt, checkedAt);
  assert.equal(page.instrument.effectiveFrom, checkedAt);

  assert.equal(capturedGuidePassages([])("CAC-PORTAL-NOTICE"), undefined);
  assert.equal(capturedGuidePassages([pageCapture("S03", "  \n ")])("CAC-PORTAL-NOTICE"), undefined);
  // The capture of one page is not another page's passage.
  assert.equal(capturedGuidePassages([capture])("TAXID-HOW-IT-WORKS"), undefined);
});

test("a guide built from captures is bound to them, and lacks whatever they do not hold", async () => {
  const cama = ["CAMA-814", "CAMA-863", "CAMA-868-forename", "CAMA-868-initials"];
  const captures = [
    actCapture("CAC-CAMA-2020", cama),
    pageCapture("CAC-BN-PROCESS", retained("CAC-BN-PROCESS")!.text),
  ];
  const built = await buildGuideCandidate("GUD-01", 1, capturedGuidePassages(captures), day);
  assert.deepEqual(built.candidate.missingEvidence, []);
  assert.equal(built.candidate.legalScopeStatus, "verified");
  assert.equal(built.candidate.sourceCheckDate, checkedAt);
  assert.ok(
    built.sources.every((source) => source.status === "approved" && source.retrievedAt === checkedAt),
  );
  // Which capture each source was read from, for the release to check again.
  const snapshots = guideSourceSnapshots(built.sources, captures);
  assert.deepEqual(Object.keys(snapshots).sort(), built.sources.map((s) => s.id).sort());
  assert.equal(snapshots["CAMA-814"], captures[0]!.snapshotId);
  assert.equal(snapshots["CAC-BN-PROCESS"], captures[1]!.snapshotId);
  assert.throws(
    () => guideSourceSnapshots(built.sources, [captures[0]!]),
    /GUIDE_SOURCE_CAPTURE_MISSING:CAC-BN-PROCESS/,
  );

  // A capture of the Act that is a different file from the one its amendment record describes:
  // the passages are found, and no source from it is marked current.
  const otherFile = { ...captures[0]!, rawChecksum: sha256("a later file at the same address") };
  const unrecorded = await buildGuideCandidate(
    "GUD-01",
    1,
    capturedGuidePassages([otherFile, captures[1]!]),
    day,
  );
  assert.equal(unrecorded.candidate.legalScopeStatus, "unverified");
  assert.ok(unrecorded.sources.filter((s) => s.id.startsWith("CAMA-")).every((s) => s.status !== "approved"));
  assert.ok(
    unrecorded.candidate.missingEvidence.some((line) => /describes a different file/.test(line)),
    unrecorded.candidate.missingEvidence.join(" | "),
  );

  // A capture without one of the passages: the sentences resting on it are reported, not bound.
  const short = [actCapture("CAC-CAMA-2020", cama.slice(0, 2)), captures[1]!];
  const lacking = await buildGuideCandidate("GUD-01", 1, capturedGuidePassages(short), day);
  assert.equal(lacking.candidate.legalScopeStatus, "unverified");
  assert.ok(
    lacking.candidate.missingEvidence.some((line) =>
      /CAMA-868-forename is not among the passages supplied/.test(line),
    ),
  );
  assert.ok(guideClaimMaps.some((map) => map.id === "GUD-01"));
});

// Made-up words throughout: no official text is used here. The passage records stand for the ones
// kept for texts that are not in the repository (guidance-captured-texts.ts).
const madeUpText = [
  "MADE-UP TEXT FOR A TEST",
  "1. The first section says one thing.",
  "   2. The second section says another thing,",
  "over two lines, and ends here.",
  "3. The third section follows.",
].join("\n");
const secondSection = "2. The second section says another thing,\nover two lines, and ends here.";
const madeUpRecords: CapturedRecords = {
  texts: [
    {
      id: "MADE-UP-TEXT",
      kind: "regulatory_document",
      leadId: "S05",
      title: "A made-up directive",
      issuingBody: "Nobody",
      effectiveFrom: "2025-01-01T00:00:00+01:00",
    },
  ],
  passages: [
    {
      id: "MADE-UP-2",
      text: "MADE-UP-TEXT",
      recordedLocator: "section 2",
      sections: ["2"],
      from: "2. The second section",
      to: "and ends here.",
      sha256: sha256(secondSection),
    },
  ],
};

test("a passage kept only as a place and a checksum is cut from a capture when its words have that checksum", () => {
  const record = madeUpRecords.passages[0]!;
  assert.equal(cutCapturedPassage(madeUpText, record), secondSection);
  // One changed character between the two places, and nothing is supplied.
  assert.equal(cutCapturedPassage(madeUpText.replace("another thing", "another  thing"), record), undefined);
  // The opening words must occur exactly once, and the closing words after them.
  assert.equal(cutCapturedPassage(`${madeUpText}\n${madeUpText}`, record), undefined);
  assert.equal(cutCapturedPassage(madeUpText.replace("and ends here.", "and stops."), record), undefined);
  assert.equal(cutCapturedPassage("another text altogether", record), undefined);
  assert.equal(cutCapturedPassage("", record), undefined);
});

test("such a passage is supplied only from a capture of its own text's address", () => {
  const capture = pageCapture("S05", madeUpText);
  const passage = capturedGuidePassages([capture], retained, madeUpRecords)("MADE-UP-2")!;
  assert.equal(passage.text, secondSection);
  assert.equal(passage.hash, sha256(secondSection));
  assert.deepEqual(passage.sections, ["2"]);
  assert.equal(passage.recordedLocator, "section 2");
  // The text is named, dated and checksummed from the capture; its kind and the day it is in force
  // from are the record's.
  assert.deepEqual(passage.instrument, {
    id: "MADE-UP-TEXT",
    kind: "regulatory_document",
    url: capture.url,
    rawSha256: capture.rawChecksum,
    title: "A made-up directive",
    issuingBody: "Nobody",
    retrievedAt: checkedAt,
    effectiveFrom: "2025-01-01T00:00:00+01:00",
  });
  assert.equal(passageLead("MADE-UP-2", retained, madeUpRecords), "S05");

  // No capture of that address, a capture of another address, or a capture with other words.
  assert.equal(capturedGuidePassages([], retained, madeUpRecords)("MADE-UP-2"), undefined);
  assert.equal(
    capturedGuidePassages([pageCapture("S04", madeUpText)], retained, madeUpRecords)("MADE-UP-2"),
    undefined,
  );
  assert.equal(
    capturedGuidePassages(
      [pageCapture("S05", madeUpText.toUpperCase())],
      retained,
      madeUpRecords,
    )("MADE-UP-2"),
    undefined,
  );
  // A passage nobody recorded is not supplied, and has no address to be read from.
  assert.equal(capturedGuidePassages([capture], retained, madeUpRecords)("MADE-UP-3"), undefined);
  assert.equal(passageLead("MADE-UP-3", retained, madeUpRecords), undefined);
  // The passages kept in the repository, and the pages, are read from their own addresses as before.
  assert.equal(passageLead("CAMA-814", retained, madeUpRecords), "SV-010");
  assert.equal(passageLead("CAC-PORTAL-NOTICE", retained, madeUpRecords), "S03");
});
