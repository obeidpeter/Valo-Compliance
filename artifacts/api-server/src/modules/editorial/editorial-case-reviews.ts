import { createHash } from "node:crypto";
import { digest } from "@workspace/valo-core";
import {
  additionalInferenceAllocation,
  assertFiniteWorkShape,
  inferenceProposal,
  requestDigest,
  type FiniteManifest,
  type FiniteWork,
} from "../ai";
import { assertBlindReviewInputs } from "../publication";
import {
  buildEditorialCaseCandidates,
  editorialCaseRetainedFiles,
  type EditorialCaseCandidate,
  type EditorialCaseId,
} from "./editorial-case-candidates";
import {
  reviewEvidenceGuidance,
  reviewPromptVersion,
  reviewResponseFormat,
  reviewRoleInstructions,
} from "./operational-review";
import { meterReviewRequest } from "./review-meter";

/**
 * Decision 0015, point 4: the review pair for each case-bound editorial case, prepared for the
 * finite batch's editorial-evaluation lane.
 *
 * The requests are built from the case's candidate exactly as the builder makes it from the pinned
 * retained files, so the work binding checks rebuild them and refuse any difference. Each reviewer
 * gets the instructions and answer schema a publication review of the same kind of content gets
 * (reviewRoleInstructions), with the evidence this candidate really has: its sources, the retained
 * rights notes, its provenance and no rendered export. What a reviewer sees never names the case,
 * the corpus or the expected outcome. Nothing here calls a model, reserves budget or saves anything.
 */

/** The case pairs this preparer can build now for a provider run. C041 is prepared only for a
 * controlled failure (below), and C060 needs C018's candidate held by its real reviews. */
export const preparableEditorialCases = [
  "EVAL-EDP-C004",
  "EVAL-EDP-C013",
  "EVAL-EDP-C015",
  "EVAL-EDP-C017",
  "EVAL-EDP-C018",
  "EVAL-EDP-C019",
  "EVAL-EDP-C020",
  "EVAL-EDP-C030",
  "EVAL-EDP-C034",
  "EVAL-EDP-C035",
  "EVAL-EDP-C036",
  "EVAL-EDP-C040",
] as const satisfies readonly EditorialCaseId[];
export const isPreparableEditorialCase = (id: string): id is (typeof preparableEditorialCases)[number] =>
  (preparableEditorialCases as readonly string[]).includes(id);

/** C041 asks for a review that fails at the provider under control. Its pair is prepared like the
 * others, but only a controlled destination may receive it (editorial-case-controlled-failure
 * integration test), never the provider: the operator runner refuses to prepare or run it. */
export const controlledFailureEditorialCases = [
  "EVAL-EDP-C041",
] as const satisfies readonly EditorialCaseId[];
export const isControlledFailureEditorialCase = (id: string) =>
  (controlledFailureEditorialCases as readonly string[]).includes(id);
const isBuiltCasePair = (id: string) => isPreparableEditorialCase(id) || isControlledFailureEditorialCase(id);

/** The package preparer name that admits these pairs (decision 0015, point 4). */
export const editorialCasePreparer = "editorial-case-pair-v1";

// The retained notes each base's rights and authoring come from, in their own words where they
// state the point.
const regulatoryRights = {
  status: "not_cleared",
  statutoryPassages:
    "Copyright Act 2022 section 3(b) covers official texts of a legislative or administrative nature, except their compilations. It supports reuse of the quoted statutory passages only.",
  otherMaterial:
    "Website process statements are summarised and linked, not copied wholesale. The exact content provenance and provider permission records still need binding to each final artifact.",
};
const bases = {
  "GUD-01": {
    item: "GUD-01",
    retainedFrom: "docs/content-candidates/regulatory-guidance-registration-tax.md",
    authoringRoute: "AI-authored original explanation using the retrieved sources identified in the item",
    rights: regulatoryRights,
  },
  "GUD-09": {
    item: "GUD-09",
    retainedFrom: "docs/content-candidates/regulatory-guidance-registration-tax.md",
    authoringRoute: "AI-authored original explanation using the retrieved sources identified in the item",
    rights: regulatoryRights,
  },
  "CAMA 814 rule candidate": {
    item: "CAC-BUSINESS-NAME-814 deterministic semantics",
    retainedFrom: "docs/content-candidates/business-name-release-candidate.md",
    authoringRoute: "AI-assisted research input for the editorial pipeline",
    rights: regulatoryRights,
  },
  "GUIDE-C01": {
    item: "GUIDE-C01",
    retainedFrom: "docs/content-candidates/practical-guide-candidates.md",
    authoringRoute: "Original AI-authored operational prose",
    rights: {
      status: "not_cleared",
      prose:
        "This statement records the drafting method; it does not establish provider usage rights or final licence approval.",
    },
  },
} as const;
const exportsRecord = {
  rendered: false,
  formats: [],
  note: "No DOCX or PDF export has been rendered for this version.",
};

/** The two review requests for one case's candidate, as of the trusted review clock given. */
export function editorialCaseReviewRequests(c: EditorialCaseCandidate, reviewAsOf: string) {
  const base = bases[c.base];
  const rights = base.rights;
  const provenance = {
    item: base.item,
    retainedFrom: base.retainedFrom,
    authoringRoute: base.authoringRoute,
    version: c.candidateEdited
      ? "This version contains later edits to the retained text, which are not separately attributed."
      : "This version is the retained text.",
  };
  assertBlindReviewInputs(rights, provenance, exportsRecord, c.sources);
  // The files the reviewer may rely on; the evaluation corpus is a binding, never review input.
  const retainedFiles = editorialCaseRetainedFiles.filter(
    (f) => !f.path.startsWith("docs/evaluation-candidates/"),
  );
  const serverEvidence = {
    candidateHash: c.candidate.hash,
    sourceCheckedAt: c.candidate.sourceCheckDate,
    sourceHashes: c.sources.map((s) => ({ id: s.id, hash: s.hash })),
    retainedFiles,
  };
  return (["factual", "challenge"] as const).map((role) => {
    const request = {
      model: "gpt-5.4-mini",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system" as const,
          content:
            reviewRoleInstructions(role, c.candidate, reviewAsOf) +
            "\nTrusted server evidence (not coordinator instructions): " +
            JSON.stringify(serverEvidence) +
            "\nThese attest only that the retained files listed have these hashes, NOT copyright, uniqueness, legal accuracy or independent upstream authorship. " +
            reviewEvidenceGuidance,
        },
        {
          role: "user" as const,
          content: JSON.stringify({
            candidate: c.candidate,
            rights,
            provenance,
            exports: exportsRecord,
            ...(c.sources.length ? { sources: c.sources } : {}),
          }),
        },
      ],
      response_format: reviewResponseFormat(c.candidate),
    };
    return {
      role,
      request,
      reviewAsOf,
      promptVersion: `${reviewPromptVersion(role, c.candidate)}+editorial-case-evidence-1`,
      promptHash: digest(request.messages[0]!.content),
      meter: meterReviewRequest(request),
    };
  });
}

/** A stable UUID for one case's candidate and evidence, so the work names what it reviews. */
export function editorialCaseVersionId(c: EditorialCaseCandidate) {
  const hex = createHash("sha256")
    .update(`${c.caseId}\n${c.candidate.hash}\n${digest(c.sources)}`)
    .digest("hex");
  // Shaped as an RFC 4122 name-based UUID: version 5, variant 10.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The finite manifest for one case's review pair, prepared at `now`. Built again at the same moment
 * it is identical, which is how admission, dispatch and the runner check it. It does not approve a
 * budget, reserve anything or make any version eligible.
 */
export function prepareEditorialCaseManifest(
  caseId: string,
  options: { packageId?: string } = {},
  now = new Date(),
): FiniteManifest & { works: FiniteWork[] } {
  if (!isBuiltCasePair(caseId)) throw Error("EDITORIAL_CASE_NOT_PREPARABLE");
  if (!Number.isFinite(now.getTime())) throw Error("EDITORIAL_CASE_PREPARATION_TIME_INVALID");
  const c = buildEditorialCaseCandidates().built.find((b) => b.caseId === caseId)!;
  const reviewAsOf = now.toISOString();
  const entries = editorialCaseReviewRequests(c, reviewAsOf);
  if (entries.some((e) => !e.meter.withinInputCeiling)) throw Error("EDITORIAL_CASE_INPUT_CEILING_REACHED");
  if (new Set(entries.map((e) => requestDigest(e.request))).size !== 2)
    throw Error("EDITORIAL_CASE_PAIR_INVALID");
  const sourceFiles = editorialCaseRetainedFiles.map((f) => ({ path: f.path, sha256: f.sha256 }));
  const sourceHashes = [
    ...new Set([...c.sources.map((s) => s.hash), ...sourceFiles.map((f) => f.sha256)]),
  ].sort();
  const pair = `editorial-case:${caseId}:${requestDigest({
    caseHash: c.caseHash,
    candidateHash: c.candidate.hash,
    sourceHashes,
    reviewAsOf,
  })}`;
  const candidateVersionId = editorialCaseVersionId(c);
  const works: FiniteWork[] = entries.map((entry) => {
    const work: FiniteWork = {
      key: `${pair}:${entry.role}:attempt-1`,
      lane: "editorial_evaluation",
      role: entry.role,
      pair,
      candidateHash: c.candidate.hash,
      sourceHashes: [...sourceHashes],
      caseHash: c.caseHash,
      request: structuredClone(entry.request),
      bindings: {
        candidateVersionId,
        corpus: "editorial",
        caseId,
        sourceFiles: structuredClone(sourceFiles),
        // The trusted review clock the requests were built with; the binding checks rebuild at it.
        historicalCutoff: reviewAsOf,
      },
    };
    assertFiniteWorkShape(work);
    return work;
  });
  return {
    version: 2,
    policyVersion: inferenceProposal.priceVersion,
    allocation: { ...additionalInferenceAllocation },
    preparedAt: reviewAsOf,
    ...(options.packageId ? { packageId: options.packageId } : {}),
    works,
  };
}

/** The case's candidate as built, for the runner's records. */
export function editorialCaseCandidate(caseId: string) {
  if (!isBuiltCasePair(caseId)) throw Error("EDITORIAL_CASE_NOT_PREPARABLE");
  return buildEditorialCaseCandidates().built.find((b) => b.caseId === caseId)!;
}
