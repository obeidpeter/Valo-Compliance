import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { assess } from "@workspace/valo-core";
import { EMPTY_FACTS } from "./checker";
import type { AssessmentItem } from "@workspace/api-client-react";
import {
  KNOWN_HOLD_REASONS,
  requirementDates,
  savedRuleChangeWords,
  requirementFigures,
  resultGaps,
  resultNotice,
  shortRulesVersion,
} from "./result-words";

/** Words of the system's own, which a customer is not asked to know. */
const SYSTEM_WORDS =
  /source-governed|released|eligible|manifest|fixture|stale|editorial|high-impact|not comprehensive|LGA\b|establish exemption/i;

/** A result of the engine itself, with no rule published: what the check answers today. */
const nothingPublished = (state: string) =>
  assess({ ...EMPTY_FACTS, state }, [], "2026-11-18", new Date("2026-11-18T09:00:00Z"));

test("a real result with no published rule has its notice and each thing it does not cover said in the site's words", () => {
  const result = nothingPublished("Lagos");
  assert.equal(result.items.length, 0);
  // The engine's own sentences hold the project's words; that is what this file is for.
  assert.match(result.notice, SYSTEM_WORDS);
  assert.equal(result.gaps.length, 3);
  for (const gap of result.gaps) assert.match(gap, SYSTEM_WORDS, gap);

  const notice = resultNotice(result.notice);
  assert.equal(
    notice,
    "This is guidance that depends on your answers. It is not a legal certificate. A missing or unknown answer never means that you are exempt.",
  );
  // The screen has said that nothing was found, so the list holds the other two.
  const gaps = resultGaps(result.gaps, true);
  assert.deepEqual(gaps, [
    "Valo does not cover every state, the FCT and every local government area. Check what applies in Lagos with the authorities there.",
    "Healthcare, financial services and energy are covered only where a published rule is about that activity.",
  ]);
  for (const said of [notice, ...gaps]) assert.doesNotMatch(said, SYSTEM_WORDS, said);
  // Where the screen has not said so, the list still does, and never as a finding that nothing applies.
  assert.deepEqual(
    resultGaps(result.gaps, false)[0],
    "No published rule covers these answers. That is not a finding that nothing applies to you.",
  );
});

test("a result for a business that gave no state names no place it does not know", () => {
  const gaps = resultGaps(nothingPublished("unanswered").gaps, true);
  assert.equal(
    gaps[0],
    "Valo does not cover every state, the FCT and every local government area. Check what applies in your area with the authorities there.",
  );
  assert.doesNotMatch(gaps.join(" "), /unanswered|your location/);
});

test("a rule the engine holds back is named with why, in plain words, for every reason the engine has", () => {
  // Every reason the engine gives, read from where it is written, so that a new one cannot be missed.
  const engine = readFileSync(
    resolve(import.meta.dirname, "../../../../lib/valo-core/src/checker.ts"),
    "utf8",
  );
  const reasons = [...engine.matchAll(/\bhold = (?:[^;]*? \? )?"([^"]+)"/g)].map((found) => found[1]!);
  assert.equal(reasons.length, 7, `the engine's reasons were read: ${reasons.join("; ")}`);
  assert.deepEqual([...new Set(reasons)].sort(), [...KNOWN_HOLD_REASONS].sort());
  for (const reason of reasons) {
    const [said] = resultGaps([`SYNTHETIC-RULE-1: ${reason}`], false);
    assert.match(said!, /^Rule SYNTHETIC-RULE-1 is on hold and gives no result here: .+\.$/, reason);
    assert.doesNotMatch(said!, SYSTEM_WORDS, reason);
    assert.ok(!said!.includes(reason), reason);
  }
  assert.equal(
    resultGaps(["SYNTHETIC-RULE-1: Evidence is stale or not yet checked"], false)[0],
    "Rule SYNTHETIC-RULE-1 is on hold and gives no result here: its review date has passed, or its sources have not been checked yet.",
  );
});

test("a sentence the screen does not know is shown as it was sent, in its place, and nothing is dropped", () => {
  const sent = [
    "Synthetic coverage gap.",
    "SYNTHETIC-RULE-2: A reason the screen has not met",
    "State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for Kano.",
  ];
  assert.deepEqual(resultGaps(sent, true), [
    "Synthetic coverage gap.",
    "SYNTHETIC-RULE-2: A reason the screen has not met",
    "Valo does not cover every state, the FCT and every local government area. Check what applies in Kano with the authorities there.",
  ]);
  assert.equal(
    resultNotice("Synthetic test fixture; not legal advice."),
    "Synthetic test fixture; not legal advice.",
  );
});

test("a result's rules version is printed by its first twelve characters, as its reference is, and any other name whole", () => {
  const { rulesetVersion } = nothingPublished("Lagos");
  assert.match(rulesetVersion, /^[0-9a-f]{64}$/);
  assert.equal(shortRulesVersion(rulesetVersion), rulesetVersion.slice(0, 12));
  assert.equal(shortRulesVersion("synthetic-ruleset"), "synthetic-ruleset");
  // Not a code of the engine's: whole, whatever its length.
  assert.equal(shortRulesVersion("G".repeat(64)), "G".repeat(64));
});

// docs/architecture/results.md, slice 2. CMP-006: "Show a deadline, rate, threshold or fee only when
// its scope and source are approved", accepted when "missing evidence shows 'Confirm with the
// authority'; an assumed due date is never scheduled automatically".
test("a requirement shows each figure its rule records with the passage it rests on, says 'Confirm with the authority' for the fees and deadlines it records none of, and shows nothing when these answers do not indicate it", () => {
  const sources = [
    {
      id: "synthetic-source",
      url: "https://example.test/source",
      title: "Synthetic Act",
      locator: "section 5",
      quote: "Synthetic passage.",
      snapshotHash: "a".repeat(64),
    },
  ];
  const fee = { kind: "fee" as const, words: "Synthetic fee words.", sourceId: "synthetic-source" };
  const deadline = {
    kind: "deadline" as const,
    words: "Synthetic deadline words.",
    sourceId: "synthetic-source",
  };
  const rate = { kind: "rate" as const, words: "Synthetic rate words.", sourceId: "synthetic-source" };
  const shown = (label: AssessmentItem["label"], figures?: AssessmentItem["figures"]) =>
    requirementFigures({ label, sources, ...(figures ? { figures } : {}) });
  // Nothing recorded: one line saying to confirm both with the authority.
  assert.deepEqual(shown("Likely relevant"), [
    { label: "Fees and deadlines", words: "Confirm with the authority." },
  ]);
  assert.deepEqual(shown("More information needed"), shown("Likely relevant"));
  // Each recorded figure in its source's words, with where in the source it is; a government fee is
  // named as one.
  assert.deepEqual(shown("May apply", [fee, rate]), [
    { label: "Government fee", words: "Synthetic fee words.", source: "Synthetic Act, section 5" },
    { label: "Rate", words: "Synthetic rate words.", source: "Synthetic Act, section 5" },
    { label: "Deadlines", words: "Confirm with the authority." },
  ]);
  assert.deepEqual(shown("Likely relevant", [deadline]), [
    { label: "Deadline", words: "Synthetic deadline words.", source: "Synthetic Act, section 5" },
    { label: "Fees", words: "Confirm with the authority." },
  ]);
  assert.deepEqual(shown("Likely relevant", [deadline, fee]).length, 2);
  // A requirement these answers do not indicate shows no figure and nothing to confirm.
  assert.deepEqual(shown("Not indicated by these answers", [fee]), []);
});

// docs/architecture/results.md, slice 3 (CMP-003, RUL-006): what the answers name that no published
// rule covers, said in the site's words.
test("a result says in the site's words that Valo has not checked the local government area or the industries the answers name, and keeps the excluded sectors", () => {
  const result = assess(
    { ...EMPTY_FACTS, state: "Lagos", lga: "Ikeja", activities: ["retail/wholesale", "energy"] },
    [],
    "2026-11-18",
    new Date("2026-11-18T09:00:00Z"),
  );
  const said = resultGaps(result.gaps, true);
  assert.deepEqual(said, [
    "Valo does not cover every state, the FCT and every local government area. Check what applies in Lagos with the authorities there.",
    "Valo has not checked the local government's own requirements for Ikeja.",
    "Valo has not checked requirements specific to retail/wholesale.",
    "Valo has not checked requirements specific to energy.",
    "Healthcare, financial services and energy are covered only where a published rule is about that activity.",
  ]);
  for (const sentence of said) assert.doesNotMatch(sentence, SYSTEM_WORDS, sentence);
});

// docs/architecture/results.md, slice 4. CMP-004: labels say "AI reviewed" or "Source checked", and
// "professionally reviewed" appears only if that review occurred and was recorded.
test("a requirement's dates each have their own label: when its sources were checked, and how and when it was released, with no professional review claimed", () => {
  const checked = "2026-11-01T09:00:00.000Z",
    published = "2026-11-12T10:00:00.000Z";
  assert.deepEqual(
    requirementDates({
      sourceCheckedAt: checked,
      publication: { route: "owner_signoff", publishedAt: published },
    }),
    ["Source checked on 1 Nov 2026", "Signed off by the Valo development owner and published on 12 Nov 2026"],
  );
  assert.deepEqual(
    requirementDates({
      sourceCheckedAt: checked,
      publication: { route: "editorial_release", publishedAt: published },
    }),
    ["Source checked on 1 Nov 2026", "AI reviewed, and published on 12 Nov 2026"],
  );
  assert.deepEqual(requirementDates({ sourceCheckedAt: checked }), ["Source checked on 1 Nov 2026"]);
  // A result saved before the dates were recorded shows none.
  assert.deepEqual(requirementDates({}), []);
  for (const route of ["owner_signoff", "editorial_release"] as const)
    for (const date of requirementDates({
      sourceCheckedAt: checked,
      publication: { route, publishedAt: published },
    }))
      assert.doesNotMatch(date, /professional/i, date);
});

// docs/architecture/rule-changes.md, slice 3 (CMP-005, EDP-011): what a saved result, or a task, says of a
// rule version that changed since, with the date and the reason given.
test("a changed rule's mark gives the new version or the withdrawal, its date and the reason given", () => {
  const change = {
    replacementVersion: 2,
    reason: "Synthetic change: the second version restates the synthetic provision",
    changedAt: "2026-11-25T09:00:00.000Z",
  };
  assert.equal(
    savedRuleChangeWords({ ...change, kind: "replaced" }),
    "Version 2 of this rule was published on 25 Nov 2026. What changed: Synthetic change: the second version restates the synthetic provision.",
  );
  assert.equal(
    savedRuleChangeWords({
      ...change,
      kind: "withdrawn",
      replacementVersion: null,
      reason: "  Synthetic withdrawal: the synthetic provision no longer applies.  ",
    }),
    "This rule was withdrawn on 25 Nov 2026. Why: Synthetic withdrawal: the synthetic provision no longer applies.",
  );
});
