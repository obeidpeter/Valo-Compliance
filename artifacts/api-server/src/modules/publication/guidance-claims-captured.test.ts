import test from "node:test";
import assert from "node:assert/strict";
import { allSourceLeads } from "@workspace/valo-core";
import { guideAmendmentRecords } from "./guidance-amendments";
import {
  buildGuideCandidate,
  guideClaimMaps,
  guidePassageIds,
  mappedGuideIds,
  repositoryBuiltGuideIds,
} from "./guidance-bundle";
import { capturedPassages, capturedTexts } from "./guidance-captured-texts";
import { passageLead } from "./guidance-captures";
import { buildGuideClaims } from "./guidance-claim-map";
import { privacyClaimMaps } from "./guidance-claims-privacy";
import { guideBodyBlocks } from "./guidance-document";
import { retainedGuidePassages } from "./guidance-passages";
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

test("the five privacy guides are mapped, and each map places every sentence of its guide", async () => {
  assert.deepEqual(
    privacyClaimMaps.map((m) => m.id),
    ["GUD-11", "GUD-12", "GUD-13", "GUD-14", "GUD-15"],
  );
  assert.deepEqual(
    capturedMaps.map((m) => m.id),
    privacyClaimMaps.map((m) => m.id),
  );
  assert.equal(mappedGuideIds.length, repositoryBuiltGuideIds.length + capturedMaps.length);
  for (const m of capturedMaps) {
    assert.equal(m.risk, "privacy");
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
    assert.ok(built.scope.byKind.source_statement >= 3, `${m.id} states what its sources say`);
    assert.deepEqual(built.claims, []);
    assert.deepEqual(built.sources, []);
    assert.equal(built.missingEvidence.length, supports(m).length, m.id);
    assert.ok(built.missingEvidence.every((line) => /is not among the passages supplied/.test(line)));
    // A sentence about the law always rests on something.
    for (const s of m.sentences)
      if (s.kind === "source_statement" || s.kind === "interpretation") assert.ok(s.support.length, s.text);
  }
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
    // names the section is checked against the passage's first words.
    if (text.kind === "act" && !/“/.test(p.from)) {
      assert.equal(p.sections.length, 1, p.id);
      assert.ok(p.from.startsWith(`${p.sections[0]}.`), p.id);
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

test("without a capture, a guide whose texts are not kept in the repository cannot be built", async () => {
  for (const m of capturedMaps)
    await assert.rejects(buildGuideCandidate(m.id), new RegExp(`GUIDE_HAS_NO_BOUND_SOURCE:${m.id}`));
});
