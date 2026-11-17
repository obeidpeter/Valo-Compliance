import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { BusinessNameCandidateBinding } from "@workspace/valo-core/checker-business-name";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const businessNameCandidateFiles = {
  candidate: "docs/content-candidates/business-name-release-candidate.json",
  passages: "docs/content-candidates/business-name-source-passages.json",
  retrieval: "docs/content-candidates/business-name-source-retrieval.json",
  algorithm: "lib/valo-core/src/checker-business-name.ts",
  corpus: "docs/evaluation-candidates/checker.json",
} as const;
type Passage = {
  passageID: string;
  sourceID: string;
  locator: string;
  exactExtractedText: string;
  textSHA256: string;
};
type Retrieval = {
  id: string;
  url: string;
  httpStatus: number;
  retrievedAt: string;
  rawSHA256: string;
  textSHA256: string;
  bytes: number;
};
function requireEvidence(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Reads retained actual passage bytes; does not manufacture a release/review manifest. */
export function bindBusinessNameCandidate(
  now = new Date(),
  read: (path: string) => string = (path) => readFileSync(join(root, path), "utf8"),
) {
  const bytes = Object.fromEntries(
    Object.entries(businessNameCandidateFiles).map(([key, path]) => [key, read(path)]),
  ) as Record<keyof typeof businessNameCandidateFiles, string>;
  const candidate = JSON.parse(bytes.candidate) as {
    candidateID: string;
    researchRevision: number;
    sourcePassagesSHA256: string;
    requiredPassageIDs: string[];
    effectiveContext: { supportedResearchAssessmentDate: string };
  };
  requireEvidence(
    candidate.candidateID === "CAC-BUSINESS-NAME-814" && candidate.researchRevision === 2,
    "Unsupported business-name candidate identity/version",
  );
  requireEvidence(
    sha(bytes.passages) === candidate.sourcePassagesSHA256,
    "Exact retained source-passage file hash mismatch",
  );
  const passages = (JSON.parse(bytes.passages) as { passages: Passage[] }).passages;
  const retrieval = JSON.parse(bytes.retrieval) as Retrieval[];
  const byPassage = new Map(passages.map((p) => [p.passageID, p]));
  const bySource = new Map(retrieval.map((s) => [s.id, s]));
  requireEvidence(
    byPassage.size === passages.length && bySource.size === retrieval.length,
    "Duplicate source or passage identity",
  );
  for (const id of candidate.requiredPassageIDs) {
    const p = byPassage.get(id);
    requireEvidence(
      p && p.locator && sha(p.exactExtractedText) === p.textSHA256 && bySource.has(p.sourceID),
      `Missing or altered required passage: ${id}`,
    );
  }
  const sourceHashes: Record<string, string> = {};
  for (const s of retrieval) {
    const fetched = Date.parse(s.retrievedAt);
    requireEvidence(
      s.httpStatus === 200 &&
        s.bytes > 0 &&
        // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with -- the record is parsed JSON, so this also fails a non-string url
        /^https:\/\//u.test(s.url) &&
        /^[a-f0-9]{64}$/u.test(s.rawSHA256) &&
        /^[a-f0-9]{64}$/u.test(s.textSHA256) &&
        Number.isFinite(fetched) &&
        fetched <= now.getTime() &&
        now.getTime() - fetched <= 30 * 86_400_000,
      `Missing, future or stale retained source: ${s.id}`,
    );
    sourceHashes[s.id] = s.rawSHA256;
  }
  const corpus = JSON.parse(bytes.corpus) as {
    cases: {
      caseID: string;
      assessmentDate: string;
      sourceCandidateID: string;
      facts: Record<string, unknown>;
    }[];
  };
  requireEvidence(
    corpus.cases.length === 80 && new Set(corpus.cases.map((c) => c.caseID)).size === 80,
    "The original 80-case corpus is required",
  );
  // Current research covers the original present-day corpus date and research day.
  // These are evaluation-policy bounds, NOT invented statutory effective dates.
  const dates = ["2026-11-13", candidate.effectiveContext.supportedResearchAssessmentDate];
  const fileHashes = Object.fromEntries(
    Object.entries(bytes).map(([key, value]) => [
      businessNameCandidateFiles[key as keyof typeof businessNameCandidateFiles],
      sha(value),
    ]),
  );
  const exactBinding = {
    mode: "isolated_candidate_validation" as const,
    candidateVersion: `business-name-v1:${sha(bytes.algorithm)}`,
    sourceVersionHashes: sourceHashes,
    supportedAssessmentDates: dates,
    fileHashes,
    passages: candidate.requiredPassageIDs.map((id) => {
      const p = byPassage.get(id)!;
      return { id, sourceId: p.sourceID, locator: p.locator, hash: p.textSHA256 };
    }),
    originalPdfBytesReverifiedThisRun: false,
    retainedPassageBytesReverifiedThisRun: true,
    publicationApproval: false,
    independentExpectedOutcomeChallenge: "not_executed_by_this_runner",
  };
  const binding: BusinessNameCandidateBinding = {
    ...exactBinding,
    bindingHash: sha(JSON.stringify(exactBinding)),
  };
  return { binding, provenance: exactBinding, corpus };
}
