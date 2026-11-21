import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { assess } from "@workspace/valo-core";
import { EMPTY_FACTS } from "./checker";
import { KNOWN_HOLD_REASONS, resultGaps, resultNotice, shortRulesVersion } from "./result-words";

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
