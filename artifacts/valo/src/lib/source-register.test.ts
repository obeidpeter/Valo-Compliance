import { test } from "node:test";
import assert from "node:assert/strict";
import { entryLine, fileButton, registerSummary, versionLine, watchLine } from "./source-register";

// ADM-003 (docs/architecture/source-register.md, slice 1): the words for the register of official sources.
test("the source register names each source's jurisdiction, instrument, version and day, and its daily check", () => {
  assert.equal(registerSummary(28, 0), "28 sources in the register");
  assert.equal(registerSummary(1, 27), "1 source in the register · 27 kept in the repository not filed yet");
  assert.equal(fileButton(28), "File the 28 sources kept in the repository");
  assert.equal(
    entryLine({
      jurisdiction: "Nigeria",
      instrument: "act",
      versionInForce: "As enacted",
      effectiveFrom: "2023-06-12",
    }),
    "Nigeria · Act · As enacted · in effect from 12 Jun 2023",
  );
  assert.equal(
    entryLine({ jurisdiction: "Lagos", instrument: null, versionInForce: null, effectiveFrom: null }),
    "Lagos",
  );
  assert.equal(watchLine(null), "Not watched by the daily check");
  assert.equal(
    watchLine({ checkedAt: null, failureCode: null, nextCheckAt: null }),
    "Watched; waiting for its first check",
  );
  assert.equal(
    watchLine({ checkedAt: null, failureCode: "SOURCE_ATTEMPT_LIMIT", nextCheckAt: null }),
    "The daily check could not read it (SOURCE_ATTEMPT_LIMIT)",
  );
  // On a Lagos clock: 08:00 UTC is 09:00 in Lagos.
  assert.equal(
    watchLine({
      checkedAt: "2026-11-25T08:00:00Z",
      failureCode: null,
      nextCheckAt: "2026-11-26T08:00:00Z",
    }),
    "Checked by the daily check 25 Nov 2026, 09:00 · next check 26 Nov 2026, 09:00",
  );
  // On a Lagos clock: 23:30 UTC on 24 November is 25 November in Lagos.
  assert.equal(
    versionLine({
      version: 2,
      createdAt: "2026-11-24T23:30:00Z",
      reason: "Synthetic: the edition was named.",
    }),
    "Version 2, 25 Nov 2026: Synthetic: the edition was named.",
  );
});
