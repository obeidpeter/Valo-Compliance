import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PrivacyCaseDetailEventsItemActorType,
  PrivacyCaseDetailStepsItemStatus,
  PrivacyCaseKind,
  PrivacyCaseStatus,
} from "@workspace/api-client-react";
import {
  PRIVACY_KIND_WORDS,
  PRIVACY_STATUS_WORDS,
  PRIVACY_STEP_STATUS_WORDS,
  privacyActionWords,
  privacyActorWords,
  privacyKindWords,
  privacyStatusWords,
  privacyStepStatusWords,
  privacyStepWords,
} from "./privacy-words";

/** The systems the API tracks a request through, as it names them. */
const SYSTEMS = [
  "identity_verification",
  "application",
  "private_files",
  "managed_identity",
  "external_processors",
  "retention_and_recovery",
];

test("every state, kind, step and actor the API sends for a privacy request has words, with none of the system's names", () => {
  const all = [
    ...Object.values(PrivacyCaseStatus).map(privacyStatusWords),
    ...Object.values(PrivacyCaseKind).map(privacyKindWords),
    ...Object.values(PrivacyCaseDetailStepsItemStatus).map(privacyStepStatusWords),
    ...Object.values(PrivacyCaseDetailEventsItemActorType).map(privacyActorWords),
    ...SYSTEMS.map(privacyStepWords),
  ];
  for (const words of all) {
    assert.ok(words.length > 1, words);
    assert.doesNotMatch(words, /_/, words);
    assert.match(words, /^[A-Z]/, words);
  }
  assert.deepEqual(Object.keys(PRIVACY_STATUS_WORDS).sort(), Object.values(PrivacyCaseStatus).sort());
  assert.deepEqual(Object.keys(PRIVACY_KIND_WORDS).sort(), Object.values(PrivacyCaseKind).sort());
  assert.deepEqual(
    Object.keys(PRIVACY_STEP_STATUS_WORDS).sort(),
    Object.values(PrivacyCaseDetailStepsItemStatus).sort(),
  );
  // Each system has its own words: none is left to the spelt-out fallback.
  assert.equal(new Set(SYSTEMS.map(privacyStepWords)).size, SYSTEMS.length);
  assert.equal(privacyStepWords("external_processors"), "Other services Valo uses");
});

test("no state claims more than the server's: only its 'fulfilled' reads as done, and 'partially fulfilled' reads as partly done", () => {
  assert.equal(privacyStatusWords("fulfilled"), "Done");
  assert.equal(privacyStatusWords("partially_fulfilled"), "Partly done");
  for (const status of Object.values(PrivacyCaseStatus))
    if (status !== "fulfilled")
      assert.doesNotMatch(privacyStatusWords(status), /^done$|deleted|complete/i, status);
  // A kind is named as the form named it.
  assert.equal(privacyKindWords("deletion"), "Delete my data");
});

test("a name this build has no words for is spelt out, not passed off as another", () => {
  assert.equal(privacyStatusWords("legal_review"), "Legal review");
  assert.equal(privacyStepWords("archive_store"), "Archive store");
  assert.equal(privacyActionWords("erasure_quarantined"), "Erasure quarantined");
  assert.equal(privacyActorWords("worker"), "Valo's system");
});
