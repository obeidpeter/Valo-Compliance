import assert from "node:assert/strict";
import { test } from "node:test";
import { readiness, requirements } from "@workspace/valo-records";
import {
  FREE_JOURNEY,
  acceptancePack,
  acceptanceSummary,
  evidenceParts,
  packRequirementIds,
} from "./acceptance-pack";
import { readCitations, type TestRecord } from "./ci-evidence";

/**
 * The acceptance pack (docs/architecture/acceptance-pack.md): each user-test pack's required
 * evidence placed part by part, and the cited tests' results from a run. It accepts nothing.
 */
const packs = readiness().uatPackages;
const ids = requirements.map((r) => r.id);
const citations = readCitations();

test("each pack's required evidence is placed part by part, in the specification's own words", () => {
  assert.deepEqual(Object.keys(evidenceParts).sort(), packs.map((p) => p.id).sort());
  for (const pack of packs) {
    const parts = evidenceParts[pack.id]!;
    assert.ok(parts.length > 0, pack.id);
    assert.equal(parts.map((part) => part.text).join(" "), pack.requiredEvidence, pack.id);
  }
});

test("a pack's reference names families, ranges or both, and a token that names nothing is refused", () => {
  assert.deepEqual(packRequirementIds("PAY-001–009: purchase", ids), [
    "PAY-001",
    "PAY-002",
    "PAY-003",
    "PAY-004",
    "PAY-005",
    "PAY-006",
    "PAY-007",
    "PAY-008",
    "PAY-009",
  ]);
  const families = packRequirementIds("WEB, DOC, EDT: visitor", ids);
  assert.deepEqual(
    families,
    ids.filter((id) => /^(WEB|DOC|EDT)-/.test(id)),
  );
  const mixed = packRequirementIds("ADM + EDP-001–012: draft", ids);
  assert.deepEqual(
    mixed,
    ids.filter((id) => id.startsWith("ADM-") || /^EDP-(0\d\d|01[0-2])$/.test(id)),
  );
  assert.ok(!mixed.includes("EDP-013"));
  assert.throws(() => packRequirementIds("XYZ: nothing", ids), /ACCEPTANCE_PACK_REFERENCE_UNKNOWN:XYZ/);
  assert.throws(
    () => packRequirementIds("PAY-050–060: nothing", ids),
    /ACCEPTANCE_PACK_REFERENCE_UNKNOWN:PAY-050–060/,
  );
});

test("each pack covers requirements the register holds, and each part a script gives names requirements with cited tests", () => {
  for (const pack of packs) {
    const covered = packRequirementIds(pack.requirements, ids);
    assert.ok(covered.length > 0, pack.id);
    for (const part of evidenceParts[pack.id]!) {
      if (part.by !== "script") {
        assert.equal(part.requirements, undefined, `${pack.id}: ${part.text}`);
        continue;
      }
      assert.ok(part.requirements && part.requirements.length > 0, `${pack.id}: ${part.text}`);
      for (const id of part.requirements) {
        assert.ok(ids.includes(id), `${id} is a requirement`);
        assert.ok(
          citations.some((c) => c.requirement === id),
          `${id} has a cited test`,
        );
      }
      // A test a part names is cited for one of its requirements, so a renamed test cannot drop out.
      for (const name of part.only ?? [])
        assert.ok(
          citations.some((c) => c.test === name && part.requirements!.includes(c.requirement)),
          `${pack.id}: "${name}" is cited for ${part.requirements.join(" or ")}`,
        );
    }
  }
});

test("UAT-01's recording is the free journey's test, and its part counts that test alone", () => {
  const part = evidenceParts["UAT-01"]![0]!;
  assert.equal(part.text, "Recorded mobile/desktop journey;");
  assert.equal(part.by, "script");
  assert.deepEqual(part.only, [FREE_JOURNEY]);
  const journey = citations.filter((c) => c.test === FREE_JOURNEY);
  assert.deepEqual(journey.map((c) => c.requirement).sort(), ["DOC-005", "EDT-002"]);
  assert.ok(journey.every((c) => c.job === "postgres"));
  // The requirements it names have other tests cited too, which the part does not count.
  assert.ok(citations.filter((c) => part.requirements!.includes(c.requirement)).length > journey.length);
  const records: TestRecord[] = journey.map((c) => ({
    file: c.file,
    path: [c.test],
    status: "pass",
    kind: "test",
  }));
  const run = acceptancePack(citations, records);
  const counted = run.packs.find((p) => p.id === "UAT-01")!.parts[0]!;
  assert.ok("tests" in counted && counted.tests);
  assert.equal(counted.tests.cited, journey.length);
  assert.equal(counted.tests.pass, journey.length);
});

test("the pack counts each part's cited tests by their results in a run, and accepts no pack", () => {
  // Without a run, every cited test is reported as not run.
  const unrun = acceptancePack(citations, undefined);
  assert.equal(unrun.accepts, false);
  assert.equal(unrun.resultsFromThisRun, false);
  for (const pack of unrun.packs) {
    assert.equal(pack.accepted, false);
    assert.equal(pack.citedTests.pass, 0);
    assert.equal(pack.citedTests.notRun, pack.citedTests.cited);
  }
  // A pack counts only the tests cited for the requirements its reference names: UAT-02's are those
  // of PAY-001 to PAY-009, each listed as not run.
  const payments = unrun.packs.find((p) => p.id === "UAT-02")!;
  assert.ok(payments.citedTests.cited > 0);
  assert.equal(payments.citedTests.problems.length, payments.citedTests.cited);
  assert.ok(
    payments.citedTests.problems.every((line) => /^PAY-00[1-9] "/.test(line)),
    "UAT-02 counts the payment requirements' tests and no others",
  );
  // A run in which every test cited for RUL-008 passed but one, which failed.
  const cited = citations.filter((c) => c.requirement === "RUL-008");
  assert.ok(cited.length >= 2);
  const records: TestRecord[] = cited.map((c, i) => ({
    file: c.file,
    path: [c.test],
    status: i === 0 ? "fail" : "pass",
    kind: "test",
  }));
  const run = acceptancePack(citations, records);
  assert.equal(run.resultsFromThisRun, true);
  const uat05 = run.packs.find((p) => p.id === "UAT-05")!;
  assert.equal(uat05.accepted, false);
  const suite = uat05.parts[0]!;
  assert.equal(suite.by, "script");
  assert.ok(suite.tests);
  // A test cited for one requirement more than once counts once for each citation.
  const first = `${cited[0]!.file}|${cited[0]!.test}`;
  const failing = cited.filter((c) => `${c.file}|${c.test}` === first).length;
  assert.equal(suite.tests.cited, cited.length);
  assert.equal(suite.tests.fail, failing);
  assert.equal(suite.tests.pass, cited.length - failing);
  assert.ok(suite.tests.problems.every((line) => line.startsWith('RUL-008 "') && line.endsWith(" fail")));
  // A part only the owner can give carries no tests.
  const uat02 = run.packs.find((p) => p.id === "UAT-02")!;
  assert.ok(uat02.parts.every((part) => part.by === "owner" && !("tests" in part)));
});

test("the summary says nothing is accepted and lists every part of every pack", () => {
  const summary = acceptanceSummary(acceptancePack(citations, undefined));
  assert.match(
    summary,
    /Nothing here accepts a pack: each needs all of its evidence and the owner's approval\./,
  );
  const rows = summary.split("\n").filter((line) => /^\| UAT-\d\d \|/.test(line));
  assert.equal(
    rows.length,
    Object.values(evidenceParts).reduce((n, parts) => n + parts.length, 0),
  );
});
