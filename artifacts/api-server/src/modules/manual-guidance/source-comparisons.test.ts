import { strict as assert } from "node:assert";
import test from "node:test";
import { manualJointTaxIdUrl, manualMinistryLabourUrl } from "@workspace/valo-core";
import { guideSourceDecision, type GuidePassage } from "../publication";
import { compareManualEmployment, manualCheckedPassages } from "./source-comparisons";

const at = new Date("2026-11-22T18:00:00Z");
const page: GuidePassage = {
  id: "TAXID-HOW-IT-WORKS",
  text: "Test page",
  hash: "a".repeat(64),
  sections: [],
  recordedLocator: "How Tax ID Retrieval Works",
  instrument: {
    id: "JRB-TAXID-HOW",
    url: manualJointTaxIdUrl,
    kind: "official_page",
    rawSha256: "b".repeat(64),
    title: "Test page",
    issuingBody: "Joint Revenue Board",
    retrievedAt: at.toISOString(),
    effectiveFrom: at.toISOString(),
  },
};

test("the manual tax permission is confined to one issuer, passage and address", () => {
  assert.equal(guideSourceDecision(page, at).status, "held");
  assert.equal(guideSourceDecision(page, at, undefined, undefined, true).status, "approved");
  for (const other of [
    { ...page, id: "different passage" },
    { ...page, instrument: { ...page.instrument, id: "NRS-TAXID-HOW" } },
    { ...page, instrument: { ...page.instrument, url: manualJointTaxIdUrl + "/elsewhere" } },
  ])
    assert.equal(guideSourceDecision(other, at, undefined, undefined, true).status, "held");
  const altered = {
    leadId: page.instrument.id,
    url: manualJointTaxIdUrl,
    rawChecksum: "a".repeat(64),
    checkedAt: at.toISOString(),
    text: "Different tax instructions.",
    mime: "text/html",
    retrieval: "official_url" as const,
  };
  assert.equal(manualCheckedPassages([altered])(page.id), undefined);
});

test("employment corroboration requires both editions and every cited passage", () => {
  const registered = {
    leadId: "NIPC-LABOUR-ACT",
    url: "https://m.nipc.gov.ng/assets/resources/labour-act/labour-act.pdf",
    rawChecksum: "ee8bf3aa6607d6322327b51cc882f139d3e9a3c5bff9243b360dc122daae3eb6",
    checkedAt: at.toISOString(),
    text: "Synthetic input",
    mime: "application/pdf",
    retrieval: "official_url" as const,
  };
  const ministry = {
    ...registered,
    leadId: "NELEX-LABOUR-ACT",
    url: manualMinistryLabourUrl,
    rawChecksum: "a53b7028b803a6c4a6879df5f63aee2c9abda98bef71de5210e73630bd6fd4bc",
  };
  for (const pair of [
    [registered],
    [ministry],
    [registered, ministry],
    [registered, { ...ministry, rawChecksum: "c".repeat(64) }],
  ]) {
    const evidence = compareManualEmployment("GUD-29", pair, manualCheckedPassages(pair));
    assert.ok(evidence.holds.length);
    assert.equal(evidence.records, undefined);
    assert.deepEqual(evidence.sources, []);
  }
  assert.deepEqual(
    compareManualEmployment("GUD-26", [], () => undefined),
    { sources: [], holds: [] },
  );
});
