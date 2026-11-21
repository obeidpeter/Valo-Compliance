import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildBusinessNameEvidence,
  businessNameSourceIds,
  validateBusinessNamePassages,
} from "./business-name-evidence";
import { referenceFor, assertSourceUrl, sourceBodyLimit, MAX_INSTRUMENT_BYTES } from "./source-fetch";
const bundle = JSON.parse(
  readFileSync(
    new URL("../../../../../docs/valo/evidence/business-name/candidate.json", import.meta.url),
    "utf8",
  ),
);
const passages = Object.fromEntries(
  bundle.passages.map((p: { id: string; text: string }) => [p.id, p.text]),
) as Parameters<typeof validateBusinessNamePassages>[0];
test("actual retained passage bundle includes all814 conditions/exceptions and scoped rights", () => {
  assert.equal(validateBusinessNamePassages(passages), true);
  for (const p of bundle.passages) assert.equal(createHash("sha256").update(p.text).digest("hex"), p.hash);
  assert.equal(bundle.references.length, 4);
});
for (const [name, phrase] of [
  ["succession", "succession to a former owner"],
  ["shared surname", "addition\n                  of an “s”"],
  ["court appointment", "receiver or manager"],
] as const) {
  test(`omitting ${name} exception holds the candidate`, () => {
    const text = passages.cama814.replace(phrase, "[omitted]");
    assert.notEqual(text, passages.cama814, "Fixture must actually remove the targeted text");
    assert.throws(
      () => validateBusinessNamePassages({ ...passages, cama814: text }),
      /CAMA814_EXCEPTION_MISSING/,
    );
  });
}
test("missing individual or corporate name-composition branches cannot pass", () => {
  for (const phrase of ["case of an individual", "corporate name"]) {
    assert.throws(
      () =>
        validateBusinessNamePassages({ ...passages, cama814: passages.cama814.replace(phrase, "[omitted]") }),
      /CAMA814_NAME_COMPOSITION_MISSING/,
    );
  }
});
test("section815 deadlines are excluded, not inferred from adjoining pages", () => {
  assert.throws(
    () => validateBusinessNamePassages({ ...passages, cama814: passages.cama814 + "\n815 within 28 days" }),
    /OUT_OF_SCOPE_DEADLINE/,
  );
});
test("place-of-business scope cannot be omitted", () => {
  assert.throws(
    () =>
      validateBusinessNamePassages({
        ...passages,
        cama814: passages.cama814.replace("in Nigeria", "elsewhere"),
      }),
    /NIGERIA_BUSINESS_SCOPE_MISSING/,
  );
});
test("plural-surname and succession exceptions retain their limiting conditions", () => {
  for (const pattern of [
    /two or more individual partners have the same surname/,
    /addition merely indicates/,
  ]) {
    const text = passages.cama814.replace(pattern, "[condition omitted]");
    assert.notEqual(text, passages.cama814);
    assert.throws(
      () => validateBusinessNamePassages({ ...passages, cama814: text }),
      /EXCEPTION_CONDITION_MISSING/,
    );
  }
});
test("NCC compilation exception is mandatory and not blanket website/provider rights", () => {
  assert.throws(
    () =>
      validateBusinessNamePassages({
        ...passages,
        copyright3b: passages.copyright3b.replace("except their compilations", "[omitted]"),
      }),
    /STATUTORY_RIGHTS_EXCEPTION_MISSING/,
  );
  assert.ok(bundle.rightsEvidence.excludes.includes("AI provider output or account terms"));
  assert.ok(bundle.rightsEvidence.excludes.includes("Website design or copy"));
});
test("actual CAMA20 references both281 and283; BFA amendment cannot be omitted", () => {
  assert.throws(
    () => validateBusinessNamePassages({ ...passages, cama20: "section20 only" }),
    /DEPENDENCY_MISSING/,
  );
  assert.throws(
    () => validateBusinessNamePassages({ ...passages, bfaPartI: "No reviewed amendment text" }),
    /AMENDMENT_MISSING/,
  );
});
test("process evidence includes official availability, form and self-registration steps", () => {
  assert.throws(
    () => validateBusinessNamePassages({ ...passages, process: "Registration available" }),
    /CAC_PROCESS_PASSAGE_MISSING/,
  );
  assert.ok(!/join thousands|At your service 24/i.test(passages.process));
});
test("retrieved original instrument does not imply currentness or release", () => {
  assert.equal(bundle.amendmentReview.currentness, "unverified");
  assert.equal(bundle.customerUseEligible, false);
  assert.equal(bundle.publication, "held");
  assert.ok(bundle.excluded.includes("Company formation capacity"));
  assert.match(bundle.negativeResultScope, /never all registrations/);
});
test("changed checksum, missing source and expired retrieval fail before candidate construction", () => {
  const now = new Date("2026-11-14T12:00:00Z"),
    text = "synthetic rejection-only payload";
  const checksum = createHash("sha256").update(text).digest("hex");
  const sources = businessNameSourceIds.map((sourceId) => ({
    id: "synthetic",
    sourceId,
    text,
    textChecksum: checksum,
    fetchedAt: now.toISOString(),
  }));
  assert.throws(() => buildBusinessNameEvidence(sources.slice(1), now), /EXACT_SOURCE_SET/);
  assert.throws(
    () =>
      buildBusinessNameEvidence(
        sources.map((s, i) => (i ? s : { ...s, text: "altered" })),
        now,
      ),
    /SOURCE_HASH/,
  );
  assert.throws(
    () =>
      buildBusinessNameEvidence(
        sources.map((s) => ({ ...s, fetchedAt: "2025-01-01T00:00:00Z" })),
        now,
      ),
    /STALE/,
  );
});
test("new official instruments are explicit allowlist entries, not arbitrary browsing", () => {
  for (const id of businessNameSourceIds) assert.equal(referenceFor(id).id, id);
  for (const id of ["NIPC-BFA-2022", "NCC-COPYRIGHT"])
    assert.equal(sourceBodyLimit(id), MAX_INSTRUMENT_BYTES);
  const lead = referenceFor("CAC-BN-PROCESS");
  assert.throws(() => assertSourceUrl(lead.url, "https://127.0.0.1/internal"), /NOT_ALLOWLISTED/);
});
