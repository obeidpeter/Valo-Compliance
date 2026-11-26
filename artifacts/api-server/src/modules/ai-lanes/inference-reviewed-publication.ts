import { and, eq, sql } from "drizzle-orm";
import { digest, publicationSchema, type PublicationBundle } from "@workspace/valo-core";
import {
  additionalInferenceAllocation,
  requestDigest,
  type FiniteManifest,
  type ManagedCompletionResult,
} from "../ai";
import {
  enhancedChecksFromReviews,
  evaluateOperationalRelease,
  getPublicationArtifact,
  operationalReviewSchemaFor,
  OWNER_SOURCE_CHECK_REQUIRED,
  publishOperationalVersion,
  recordActualPublicationHold,
  reviewedGuideChecked,
  type ArtifactRef,
  type ReleaseAttestations,
} from "../publication";
import { readOperationalInferenceReadiness } from "./inference-operational-ready";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";

/** A saved candidate that passes the gate goes to the publisher, which rechecks every gate; one that
 * fails is held, with the reasons the gate gives. */
async function releaseOrHold(versionId: string, eligibility: ReturnType<typeof evaluateOperationalRelease>) {
  return eligibility.decision === "eligible"
    ? await publishOperationalVersion(versionId)
    : { ...(await recordActualPublicationHold(versionId)), decision: "held" as const };
}

/**
 * A guide that passes every gate is saved and released only once the development owner has checked its
 * exact candidate's sources, within the last day (decision 0018; docs/architecture/reviewed-route.md,
 * part 2). Without that check nothing is saved or held: the owner checks again, at no cost, and the
 * command is run again. A guide that fails a gate is saved and held as any version is.
 */
async function assertGuideCheckedBeforeRelease(
  reader: Parameters<typeof reviewedGuideChecked>[0],
  versionId: string,
  bundle: PublicationBundle,
  attestations: ReleaseAttestations,
  eligibility: ReturnType<typeof evaluateOperationalRelease>,
) {
  if (
    eligibility.decision === "eligible" &&
    bundle.candidate.contentClass === "sourced_guidance" &&
    !(await reviewedGuideChecked(reader, versionId, bundle.candidate.hash, attestations.sourceSnapshots))
  )
    throw Error(OWNER_SOURCE_CHECK_REQUIRED);
}

type ReviewRecord = {
  role: "factual" | "challenge";
  candidateHash: string;
  evidenceHash: string;
  providerResponseId: string;
  model: string;
  promptVersion: string;
  requestHash: string;
  reviewPlanHash: string;
  receivedOtherVerdict: boolean;
  serverEvidence: unknown;
  output: unknown;
};

/**
 * Decision 0014: publish a prepared candidate once its two finite reviews have run. Each review
 * record must be the one the owner-approved batch settled for this candidate: the same candidate,
 * plan, request and server evidence, and the provider response the ledger recorded for its work.
 * The version is then saved, with its reviews, under the ID chosen when it was prepared, and handed
 * to the publisher, which rechecks every gate. A bundle that fails a gate is saved and held instead,
 * as TPL-07's one-step path does. Nothing here calls a model.
 */
export async function publishReviewedOperationalCandidate(input: {
  batchId: string;
  reviews: ArtifactRef[];
}) {
  assertDevelopmentRuntime();
  if (!/^[-a-zA-Z0-9_:]{1,160}$/.test(input.batchId) || input.reviews.length !== 2)
    throw Error("REVIEWED_PAIR_ARGUMENTS_INVALID");
  const { db, valoContentVersions } = await import("@workspace/db");
  const [batch] = (
    await db.execute(
      sql`select manifest, manifest_hash, results from valo_inference_batches where id=${input.batchId}`,
    )
  ).rows as { manifest: FiniteManifest; manifest_hash: string; results: Record<string, unknown> }[];
  if (!batch || requestDigest(batch.manifest) !== batch.manifest_hash)
    throw Error("INFERENCE_MANIFEST_INVALID");
  const works = batch.manifest.works;
  const [first, second] = works;
  if (
    batch.manifest.version !== 2 ||
    batch.manifest.allocation?.id !== additionalInferenceAllocation.id ||
    works.length !== 2 ||
    !first ||
    !second ||
    works.some((w) => w.lane !== "publication") ||
    !first.pair ||
    first.pair !== second.pair ||
    !first.bindings.candidateVersionId ||
    !first.bindings.candidateArtifact ||
    first.bindings.candidateVersionId !== second.bindings.candidateVersionId ||
    requestDigest(first.bindings.candidateArtifact) !== requestDigest(second.bindings.candidateArtifact) ||
    requestDigest(first.bindings.operationalPlan) !== requestDigest(second.bindings.operationalPlan) ||
    new Set(works.map((w) => w.role)).size !== 2
  )
    throw Error("REVIEWED_PAIR_BATCH_INVALID");
  const versionId = first.bindings.candidateVersionId;

  // A version already saved under this ID (a rerun after a stop) goes straight to its outcome: one
  // still a candidate is published or held as the first run would have done, and the publisher
  // rechecks its gates.
  const [saved] = await db.select().from(valoContentVersions).where(eq(valoContentVersions.id, versionId));
  if (saved) {
    if (saved.candidateHash !== first.candidateHash) throw Error("CANDIDATE_ALREADY_SAVED");
    if (saved.status !== "candidate")
      return { id: versionId, decision: saved.status, idempotent: true, rerun: true };
    const eligibility = evaluateOperationalRelease(saved.bundle);
    await assertGuideCheckedBeforeRelease(
      db,
      versionId,
      publicationSchema.parse(saved.bundle),
      saved.attestations as ReleaseAttestations,
      eligibility,
    );
    const release = await releaseOrHold(versionId, eligibility);
    return { id: versionId, decision: release.decision, release, rerun: true };
  }

  const current = await readOperationalInferenceReadiness({
    candidateVersionId: versionId,
    candidateArtifact: first.bindings.candidateArtifact,
  });
  if (current.row.candidateHash !== first.candidateHash || requestDigest(current.bundle) !== first.caseHash)
    throw Error("CANDIDATE_BINDING_CHANGED");

  // The finite allocation's ledger: a review counts only once its work there is settled, with the
  // provider response and result the batch recorded.
  const [ledger] = (
    await db.execute(
      sql`select state from valo_inference_budgets where id=${additionalInferenceAllocation.id}`,
    )
  ).rows as {
    state: { entries?: { runKey: string; status: string; responseId?: string; resultRef?: string }[] };
  }[];
  const records = await Promise.all(
    input.reviews.map(async (ref) => ({
      ref,
      record: JSON.parse((await getPublicationArtifact(ref)).toString()) as ReviewRecord,
    })),
  );
  const providerIds = new Set<string>();
  const reviewed = records.map(({ ref, record }) => {
    const work = works.find((w) => w.role === record.role);
    const settled = work ? (batch.results[work.key] as ManagedCompletionResult | undefined) : undefined;
    const entry = work
      ? ledger?.state.entries?.find((e) => e.runKey === `${input.batchId}:${work.key}`)
      : undefined;
    if (
      !work ||
      !settled ||
      settled.id !== record.providerResponseId ||
      settled.model !== record.model ||
      entry?.status !== "settled" ||
      entry.responseId !== settled.id ||
      entry.resultRef !== requestDigest(settled)
    )
      throw Error("REVIEW_NOT_SETTLED_BY_APPROVED_BATCH");
    if (
      record.candidateHash !== current.candidate.hash ||
      record.requestHash !== requestDigest(work.request) ||
      record.reviewPlanHash !== work.bindings.operationalPlan?.hash ||
      record.receivedOtherVerdict !== false ||
      digest(record.serverEvidence) !== digest(current.serverEvidence) ||
      record.evidenceHash !== digest(current.bundle.sources)
    )
      throw Error("REVIEW_BINDING_CHANGED");
    providerIds.add(record.providerResponseId);
    return { ref, record, output: operationalReviewSchemaFor(current.candidate).parse(record.output) };
  });
  if (providerIds.size !== 2 || new Set(reviewed.map((r) => r.record.role)).size !== 2)
    throw Error("REVIEWS_NOT_INDEPENDENT");

  // The prepared bundle, now with its two reviews and, for content that is not general, the
  // enhanced checks both reviews ran.
  const prepared = current.bundle;
  const bundle: PublicationBundle = {
    ...prepared,
    reviews: reviewed.map(({ record, output }) => ({
      runId: record.providerResponseId,
      model: record.model,
      promptVersion: record.promptVersion,
      candidateHash: record.candidateHash,
      evidenceHash: record.evidenceHash,
      role: record.role,
      verdict: output.verdict,
      findings: [...output.findings, ...output.missingEvidence],
      receivedOtherVerdict: false,
    })),
    enhancedChecks:
      prepared.candidate.risk === "general"
        ? []
        : enhancedChecksFromReviews(
            prepared,
            reviewed.map(({ record, output }) => ({ role: record.role, output })),
          ),
  };
  bundle.manifest = {
    ...prepared.manifest,
    status:
      bundle.reviews.length === 2 && bundle.reviews.every((r) => r.verdict === "pass" && !r.findings.length)
        ? "eligible"
        : "review",
    reviewHash: digest({ draft: bundle.draftRun, reviews: bundle.reviews }),
    checksHash: digest({ mechanical: bundle.mechanicalChecks, enhanced: bundle.enhancedChecks }),
  };
  publicationSchema.parse(bundle);
  const attestations: ReleaseAttestations = {
    ...(current.row.attestations as ReleaseAttestations),
    reviews: reviewed.map(({ ref }) => ref),
  };
  const eligibility = evaluateOperationalRelease(bundle);
  await assertGuideCheckedBeforeRelease(db, versionId, bundle, attestations, eligibility);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    await tx.insert(valoContentVersions).values({
      id: versionId,
      templateId: current.row.templateId,
      version: current.row.version,
      slug: current.row.slug,
      policyId: current.row.policyId,
      candidateHash: current.row.candidateHash,
      bundle,
      attestations,
      reviewBy: current.row.reviewBy,
    });
  });
  const release = await releaseOrHold(versionId, eligibility);
  const [stored] = await db
    .select({ status: valoContentVersions.status })
    .from(valoContentVersions)
    .where(
      and(
        eq(valoContentVersions.id, versionId),
        eq(valoContentVersions.candidateHash, bundle.candidate.hash),
      ),
    );
  return {
    id: versionId,
    templateId: current.row.templateId,
    version: current.row.version,
    candidateHash: bundle.candidate.hash,
    eligibility,
    release,
    status: stored?.status ?? null,
    reviews: bundle.reviews.map((r) => ({ role: r.role, runId: r.runId, verdict: r.verdict })),
    rerun: false,
  };
}
