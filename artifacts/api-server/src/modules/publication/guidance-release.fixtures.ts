import { randomUUID } from "node:crypto";
import { digest, mandatoryEnhancedChecks, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { AmendmentRecord } from "./guidance-amendments";
import { buildGuideCandidate } from "./guidance-bundle";
import { retainedGuidePassages, type GuidePassages } from "./guidance-passages";
import { guidancePolicy } from "./guidance-policy";
import { assembleGuideBundle } from "./guidance-release";
import { enhancedChecksFromReviews } from "./operational-review-contract";
import type { ArtifactRef } from "./publication-artifacts";
import { chatGPTPermissionRecord } from "./rights-applicability";

/**
 * Test support: a guide's bundle put together as the preparer will put it together, from the
 * retained drafts and passages. The provider's terms and the two files' inspection are controlled
 * stand-ins, so nothing here shows that a real capture or a real file passed.
 */

/** Controlled pages holding the passages the provider-permission record looks for. They stand in for
 * a capture of the provider's terms; they are not the provider's pages. */
export function controlledTermsSnapshot(at: Date) {
  const ownership = "We hereby assign to you all our right, title, and interest, if any, in and to Output.";
  return {
    kind: "official_provider_terms_snapshot" as const,
    retrievedAt: at.toISOString(),
    pages: [
      { url: "https://openai.com/policies/terms-of-use/", text: ownership, truncated: false as const },
      { url: "https://openai.com/policies/eu-terms-of-use/", text: ownership, truncated: false as const },
      {
        url: "https://help.openai.com/en/articles/6783457-what-is-chatgpt",
        text: "regardless of whether output was generated through a free or paid plan",
        truncated: false as const,
      },
      {
        url: "https://openai.com/policies/service-terms/",
        text: "ChatGPT Enterprise, Edu, Healthcare and Business",
        truncated: false as const,
      },
      {
        url: "https://openai.com/policies/sharing-publication-policy/",
        text: "Content co-authored with the OpenAI API",
        truncated: false as const,
      },
    ],
  };
}

/** Where something would be kept: a reference with the checksum of what it holds. */
export const keptAs = (value: unknown): ArtifactRef => ({
  id: randomUUID(),
  hash: sha256(JSON.stringify(value)),
  extension: "json",
});

const passingFormat = {
  parsed: true,
  disclosureIncluded: true,
  scopeIncluded: true,
  limitationsIncluded: true,
  sourceDateIncluded: true,
};

/** The retained passages as if each official text had been read at the time given. */
export const passagesReadAt =
  (at: Date, passages: GuidePassages = retainedGuidePassages()): GuidePassages =>
  (id) => {
    const passage = passages(id);
    if (!passage) return undefined;
    const read = at.toISOString();
    return {
      ...passage,
      instrument: {
        ...passage.instrument,
        retrievedAt: read,
        // A page is known to say what it says from the time it is read.
        ...(passage.instrument.kind === "official_page" ? { effectiveFrom: read } : {}),
      },
    };
  };

/** A guide's bundle as it would be prepared on the day given, with both files passing inspection. */
export async function assembledGuide(
  id: string,
  now: Date,
  options: {
    policy?: PublicationBundle["policy"];
    records?: readonly AmendmentRecord[];
    passages?: GuidePassages;
  } = {},
) {
  const built = await buildGuideCandidate(
    id,
    1,
    options.passages ?? retainedGuidePassages(),
    now,
    options.records,
  );
  const snapshot = controlledTermsSnapshot(new Date(+now - 3_600_000));
  const applicability = chatGPTPermissionRecord(
    snapshot,
    built.provenance.sourceText,
    built.provenance.note,
    now,
    {
      path: built.provenance.path,
      notePath: "docs/content-candidates/r1-content-intake-manifest.json",
      templateId: id,
    },
  );
  const result = await assembleGuideBundle({
    built,
    policy: options.policy ?? (await guidancePolicy()).policy,
    termsSnapshot: snapshot,
    snapshotRef: keptAs(snapshot),
    provenanceRef: keptAs(built.provenance),
    applicability,
    exportReport: { passed: true, formats: { docx: passingFormat, pdf: passingFormat } },
    exportHashes: { docx: sha256(`${id} docx`), pdf: sha256(`${id} pdf`) },
    now,
    ...(options.records ? { amendmentRecords: options.records } : {}),
  });
  return { built, applicability, ...result };
}

/**
 * A bundle with two made-up reviews that both pass, each answering the five enhanced checks from
 * the guide's own first source. For tests of what follows the reviews: no model reviewed anything.
 */
export function withMadeUpReviews(bundle: PublicationBundle): PublicationBundle {
  const evidenceHash = digest(bundle.sources);
  const passage = bundle.sources[0]!.text.slice(0, 200);
  const outputs = (["factual", "challenge"] as const).map((role) => ({
    role,
    output: {
      verdict: "pass" as const,
      findings: [],
      missingEvidence: [],
      observations: [],
      enhancedChecks: mandatoryEnhancedChecks.map((name) => ({
        name,
        result: "pass" as const,
        passage,
        note: "made up for a test",
      })),
    },
  }));
  const reviewed: PublicationBundle = {
    ...bundle,
    reviews: outputs.map(({ role }) => ({
      runId: `no-model-was-called-${role}`,
      model: "none: made up for a test",
      promptVersion: "made up for a test",
      candidateHash: bundle.candidate.hash,
      evidenceHash,
      role,
      verdict: "pass",
      findings: [],
      receivedOtherVerdict: false,
    })),
    enhancedChecks: enhancedChecksFromReviews(bundle, outputs),
  };
  reviewed.manifest = {
    ...bundle.manifest,
    status: "eligible",
    reviewHash: digest({ draft: reviewed.draftRun, reviews: reviewed.reviews }),
    checksHash: digest({ mechanical: reviewed.mechanicalChecks, enhanced: reviewed.enhancedChecks }),
  };
  return reviewed;
}
