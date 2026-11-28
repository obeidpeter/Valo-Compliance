import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256, type PublicationBundle } from "@workspace/valo-core";
import { guideAmendmentRecords, type AmendmentRecord } from "./guidance-amendments";
import { capturedPassages, capturedTexts } from "./guidance-captured-texts";
import type { GuidePassage, GuidePassages } from "./guidance-passages";
import { controlledTermsSnapshot, keptAs } from "./guidance-release.fixtures";
import { publicationWorkspaceRoot } from "./operational-policy";
import { chatGPTPermissionRecord } from "./rights-applicability";
import { buildLawTemplateCandidate } from "./template-law-candidate";
import { TEMPLATE_LAW_POLICY_PATH, templateLawPolicy } from "./template-law-policy";
import { assembleLawTemplateBundle } from "./template-law-release";

/**
 * Stand-ins for the tests of a template that states the law (docs/architecture/reviewed-route.md,
 * part 4). The Data Protection Act's words are not kept in the repository, so TPL-31 is built from
 * stand-in passages: their words hold the quoted words and are otherwise not the Act's or the
 * directive's. None of it is evidence about the law.
 *
 * - A passage's identity is synthetic, an address and a checksum of no real file, with a synthetic
 *   amendment record standing for a search that found nothing later; or it is the one the repository's
 *   own amendment record describes, so that the code's own records decide whether it is current.
 * - A test's supposed approval of the policy file stands for the owner's, who has approved no text of it.
 */
export const STAND_IN_URL = "https://ndpc.gov.ng/synthetic-stand-in.pdf";
const syntheticRawSha256 = "a".repeat(64);
export type StandInIdentity = "synthetic" | "recorded";

/** Stand-in words for the passages TPL-31's claims rest on. */
export const standInWords: Record<string, string> = {
  "NDPA-29":
    "29.—(1) Where a data controller engages the services of a data (stand-in words) engaged data processor — (stand-in words).",
  "GAID-34":
    "Article 34: Data Processing Agreement (stand-in words) every data controller or data processor shall (stand-in words) carry out data processing.",
  "NDPA-40": "40.—(1) Where a personal data breach has occurred (stand-in words) under this section.",
};

/** A recorded passage of the repository's captured texts, with stand-in words, read at `readAt`. */
export function lawTemplateStandIn(
  id: string,
  words: string,
  readAt: string,
  identity: StandInIdentity = "synthetic",
): GuidePassage {
  const recorded = capturedPassages.find((p) => p.id === id)!;
  const of = capturedTexts.find((t) => t.id === recorded.text)!;
  const record = guideAmendmentRecords.find((r) => r.instrument === of.id);
  if (identity === "recorded" && !record) throw Error(`no amendment record describes ${of.id}`);
  return {
    id,
    recordedLocator: recorded.recordedLocator,
    text: words,
    hash: sha256(words),
    sections: [...recorded.sections],
    instrument: {
      id: of.id,
      kind: of.kind,
      url: identity === "recorded" ? record!.url : STAND_IN_URL,
      rawSha256: identity === "recorded" ? record!.rawSha256 : syntheticRawSha256,
      title: of.title,
      issuingBody: of.issuingBody,
      retrievedAt: readAt,
      effectiveFrom: of.effectiveFrom,
    },
  };
}

/** The stand-in passages, as a template's builder asks for them. */
export const lawTemplateStandIns =
  (
    readAt: string,
    text: Record<string, string> = standInWords,
    identity: StandInIdentity = "synthetic",
  ): GuidePassages =>
  (id) =>
    text[id] ? lawTemplateStandIn(id, text[id]!, readAt, identity) : undefined;

/** A synthetic record for each text the synthetic stand-ins are passages of: a search that found nothing. */
export function syntheticLawTemplateRecords(searchedAt: string): AmendmentRecord[] {
  return capturedTexts
    .filter((t) => t.id === "NDPC-NDPA-2023" || t.id === "NDPC-GAID-2025")
    .map((t) => ({
      instrument: t.id,
      title: t.title,
      url: STAND_IN_URL,
      rawSha256: syntheticRawSha256,
      commencement: { printed: "synthetic", effectiveFrom: t.effectiveFrom },
      searches: [
        {
          place: "A synthetic search for this test only",
          url: "https://ndpc.gov.ng/synthetic-search",
          searchedAt,
          rawSha256: "b".repeat(64),
          found: "Nothing: this search stands in for one that was not made.",
        },
      ],
      amendments: [],
      notRead: [],
      conflicts: [],
      limits: "Synthetic: no search was made.",
    }));
}

/** The policy file as it stands, and the policy under a test's supposed approval of exactly it. */
export const templateLawPolicyFile = () =>
  readFileSync(resolve(publicationWorkspaceRoot(), TEMPLATE_LAW_POLICY_PATH), "utf8");
export const supposedlyApprovedTemplateLawPolicy = async () =>
  (await templateLawPolicy({ approvedHash: sha256(templateLawPolicyFile()) })).policy;

/** An inspection of a file that passes every part of it. */
export const passingFormat = {
  parsed: true,
  disclosureIncluded: true,
  scopeIncluded: true,
  limitationsIncluded: true,
  sourceDateIncluded: true,
};

/**
 * TPL-31 built from stand-ins read an hour before `now`, with controlled provider terms captured half
 * an hour before it, and its bundle assembled: under the policy as it stands unless another is given.
 */
export async function assembledLawTemplate(options: {
  now: Date;
  policy?: PublicationBundle["policy"];
  records?: readonly AmendmentRecord[];
  text?: Record<string, string>;
  identity?: StandInIdentity;
  pdf?: typeof passingFormat;
}) {
  const { now } = options;
  const readAt = new Date(+now - 3_600_000).toISOString();
  const built = await buildLawTemplateCandidate(
    "TPL-31",
    1,
    lawTemplateStandIns(readAt, options.text, options.identity),
    now,
    options.records,
  );
  const snapshot = controlledTermsSnapshot(new Date(+now - 1_800_000));
  const applicability = chatGPTPermissionRecord(
    snapshot,
    built.provenance.sourceText,
    built.provenance.note,
    now,
    {
      path: built.provenance.path,
      notePath: "docs/content-candidates/r1-content-intake-manifest.json",
      templateId: "TPL-31",
    },
  );
  const policy = options.policy ?? (await templateLawPolicy()).policy;
  const result = await assembleLawTemplateBundle({
    built,
    policy,
    termsSnapshot: snapshot,
    snapshotRef: keptAs(snapshot),
    provenanceRef: keptAs(built.provenance),
    applicability,
    exportReport: {
      passed: !options.pdf || Object.values(options.pdf).every(Boolean),
      formats: { docx: passingFormat, pdf: options.pdf ?? passingFormat },
    },
    exportHashes: { docx: sha256("TPL-31 docx"), pdf: sha256("TPL-31 pdf") },
    now,
    ...(options.records ? { amendmentRecords: options.records } : {}),
  });
  return { built, snapshot, applicability, policy, ...result };
}
