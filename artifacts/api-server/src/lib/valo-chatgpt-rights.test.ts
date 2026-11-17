import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import {
  chatGPTPermissionRecord,
  chatGPTSourcePath,
  assertPermissionRoute,
  verifiedRightsApplicability,
} from "../editorial/rights-applicability";

// Synthetic text tests the predicate, not actual provider permission/publication.
const now = new Date("2026-11-14T00:00:00Z");
const source = "Synthetic original operational form";
const note = `| \`${chatGPTSourcePath}\` | TPL-07 | \`${sha256(source)}\` |`;
const snapshot = {
  kind: "official_provider_terms_snapshot",
  retrievedAt: now.toISOString(),
  pages: [
    {
      url: "https://openai.com/policies/terms-of-use/",
      text: "We hereby assign to you all our right, title, and interest, if any, in and to Output.",
      truncated: false,
    },
    {
      url: "https://openai.com/policies/eu-terms-of-use/",
      text: "We hereby assign to you all our right, title, and interest, if any, in and to Output.",
      truncated: false,
    },
    {
      url: "https://help.openai.com/en/articles/6783457-what-is-chatgpt",
      text: "regardless of whether output was generated through a free or paid plan",
      truncated: false,
    },
    {
      url: "https://openai.com/policies/service-terms/",
      text: "ChatGPT Enterprise, Edu, Healthcare and Business",
      truncated: false,
    },
    {
      url: "https://openai.com/policies/sharing-publication-policy/",
      text: "Content co-authored with the OpenAI API",
      truncated: false,
    },
  ],
};
test("ChatGPT permission is scoped and hash-bound, without invented paid-plan or account-contract approval", () => {
  const result = chatGPTPermissionRecord(snapshot, source, note, now);
  assert.equal(result.verified, true);
  assert.equal(result.record.accountTerms, null);
  assert.equal(result.record.integration, "chatgpt");
  assert.equal(result.record.commercialUseScope, "chatgpt_original_operational_provider_permission_only");
  assert.match(result.record.limitations.join(" "), /third-party/);
  assert.match(result.record.limitations.join(" "), /sales approval remain false/);
  assert.doesNotThrow(() => assertPermissionRoute(result.record, false));
  assert.throws(() => assertPermissionRoute(result.record, true), /AUTHORING_RIGHTS_ROUTE_MISMATCH/);
});
test("changed original text or missing source-note binding fails before provider review", () => {
  assert.throws(
    () => chatGPTPermissionRecord(snapshot, source + " changed", note, now),
    /SOURCE_HASH_NOT_BOUND/,
  );
  assert.throws(() => chatGPTPermissionRecord(snapshot, source, "no hash", now), /SOURCE_HASH_NOT_BOUND/);
});
test("missing actual provider text, missing contextual conditions and truncated retrieval fail", () => {
  for (const index of [0, 1, 2, 3, 4]) {
    const edited = structuredClone(snapshot);
    edited.pages[index].text = "no operative passage";
    assert.throws(() => chatGPTPermissionRecord(edited, source, note, now), /PERMISSION_TEXT_MISSING/);
  }
  const truncated = structuredClone(snapshot);
  truncated.pages[0].truncated = true;
  assert.throws(() => chatGPTPermissionRecord(truncated, source, note, now));
});
test("future and expired rights evidence cannot pass; ChatGPT permission cannot clear Replit authoring", () => {
  for (const date of ["2025-01-01T00:00:00Z", "2027-01-01T00:00:00Z"]) {
    assert.equal(
      chatGPTPermissionRecord({ ...snapshot, retrievedAt: date }, source, note, now).verified,
      false,
    );
  }
  const { record } = chatGPTPermissionRecord(snapshot, source, note, now);
  assert.equal(verifiedRightsApplicability({ ...record, integration: "replit_managed_openai" }, now), false);
  assert.equal(verifiedRightsApplicability({ ...record, evidence: record.evidence.slice(1) }, now), false);
});
