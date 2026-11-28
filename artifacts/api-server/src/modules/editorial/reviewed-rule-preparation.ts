import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  candidateDigest,
  digest,
  evaluatePublication,
  isPreparedRuleId,
  publicationSchema,
  ruleSchema,
} from "@workspace/valo-core";
import { renderDocument } from "../../lib/valo-render";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  assertDrafterCanLogIn,
  capturedGuidePassages,
  developmentPublicationOnly,
  guideAmendmentRecords,
  guidancePolicy,
  getPublicationArtifact,
  guideOpenReasons,
  inspectOperationalExports,
  putPublicationArtifact,
  readPreparedCandidate,
  savePreparedCandidate,
  type AmendmentRecord,
  type GuideInstrument,
  type GuidePassages,
} from "../publication";
import { currentSourceCaptures, verifyReleasedSources, type CurrentSourceCapture } from "../sources";
import { ownerRuleCandidates, type OwnerRuleCandidate } from "./owner-rule-candidates";
import {
  buildReviewedRule,
  restoredRuleCandidate,
  reviewedRuleBundle,
  ruleScenarioResults,
  RULE_SHEET_NOTICE,
} from "./reviewed-rule";
import type { RuleReviewInputs, RuleServerEvidence } from "./reviewed-rule-review";
import { unique } from "./rule-sources";

/** The stored version a restore releases again, by its number and its release's manifest hash. */
export type RestoredVersion = { version: number; manifestHash: string };

/** Where a rule on the reviewed route was written, as its candidate keeps it: what is known, and no more. */
export function repositoryRuleProvenance(prepared: OwnerRuleCandidate, restores?: RestoredVersion) {
  return {
    kind: "repository-rule-v1" as const,
    ruleId: prepared.rule.id,
    requirementVersionId: prepared.rule.requirementVersionId,
    candidateDigest: digest(prepared),
    path: "artifacts/api-server/src/modules/editorial/owner-rule-candidates.ts",
    written:
      "Prepared in the repository for the owner's sign-off (decision 0020) and built for the reviewed route from that preparation. Its rights record says how its wording came to be. The model that drafted it is not recorded, and no model run of Valo's own produced it.",
    // A restore releases a stored version's words, condition and calculation again (ADM-004).
    ...(restores
      ? {
          restores,
          restored: `Restores the words, condition and calculation of version ${restores.version} as it was stored, with the repository's sources, claims, scenarios and records.`,
        }
      : {}),
  };
}

/**
 * The stored version of a rule a restore names, and the repository's rule with that version's words,
 * condition and calculation. Only a version earlier than the rule's latest can be restored.
 */
async function storedVersionToRestore(prepared: OwnerRuleCandidate, version: number) {
  if (!Number.isInteger(version) || version < 1) throw Error("RULE_VERSION_UNKNOWN");
  const { db } = await import("@workspace/db");
  const rows = (
    await db.execute<{ rule: unknown; manifest_hash: string; latest: number }>(
      sql`select rule, manifest_hash,
            (select max(version) from valo_rule_releases where rule_id = ${prepared.rule.id})::int as latest
          from valo_rule_releases where rule_id = ${prepared.rule.id} and version = ${version}`,
    )
  ).rows;
  const row = rows[0];
  if (!row) throw Error("RULE_VERSION_UNKNOWN");
  if (version >= Number(row.latest)) throw Error("RULE_VERSION_ALREADY_CURRENT");
  const stored = ruleSchema.parse(row.rule);
  return {
    restores: { version, manifestHash: row.manifest_hash },
    prepared: restoredRuleCandidate(prepared, stored),
  };
}

type Options = {
  /** Stands in for the repository's rules (tests). */
  candidates?: readonly OwnerRuleCandidate[];
  /** A stored version of the rule, earlier than its latest, whose words, condition and calculation are
   * prepared again as its next version (ADM-004). */
  restore?: number;
  /** Stands in for the captures the daily source check holds (tests). */
  captures?: readonly CurrentSourceCapture[];
  records?: readonly AmendmentRecord[];
  now?: Date;
};

/**
 * Prepares a rule from the repository for its two reviews on the reviewed route
 * (docs/architecture/reviewed-route.md, part 3; slice 3a).
 *
 * The rule's next version is built from today's captures of its official sources and put through the
 * gate with everything but the reviews: the guidance policy, its rights record, its sources'
 * decisions, its mechanical checks and both of its files.
 *
 * - If anything other than the two missing reviews holds it, the reasons are returned and nothing is
 *   kept.
 * - Otherwise it is kept as a prepared candidate, as a guide is: a private artifact awaiting its
 *   reviews, with a row on drafting's own login that lets staff find it. It becomes a rule version only
 *   once both reviews have passed and the release command applies it.
 *
 * Nothing here calls a model, approves anything or releases a rule.
 */
export async function prepareReviewedRuleCandidate(ruleId: string, options: Options = {}) {
  assertDevelopmentRuntime();
  developmentPublicationOnly();
  const repository = (options.candidates ?? ownerRuleCandidates).find((c) => c.rule.id === ruleId);
  if (!repository || !isPreparedRuleId(repository.rule.requirementVersionId))
    throw Error("RULE_NOT_PREPARED");
  // A restore prepares a stored version's words, condition and calculation as the next version.
  const restoring =
    options.restore === undefined ? null : await storedVersionToRestore(repository, options.restore);
  const prepared = restoring?.prepared ?? repository;
  const { db, drafterDb, valoPreparedCandidates } = await import("@workspace/db");
  // A rule that passes is kept as a candidate, which only drafting's own login may add. The preparation
  // finds out now, before anything is read, rendered or saved, whether drafting can log in.
  await assertDrafterCanLogIn();
  const now = options.now ?? new Date();
  // The next version after every version stored on either route.
  const stored = await db.execute<{ version: number }>(
    sql`select coalesce(max(version), 0)::int as version from valo_rule_releases where rule_id = ${ruleId}`,
  );
  const version = Number(stored.rows[0]!.version) + 1;
  const leads = unique(prepared.sources.map((s) => s.leadId));
  const captures = options.captures ?? (await currentSourceCaptures(leads, now));
  const { policy } = await guidancePolicy();
  const built = buildReviewedRule(prepared, {
    version,
    captures,
    passages: capturedGuidePassages(captures),
    records: options.records ?? guideAmendmentRecords,
    policy,
    now,
  });
  const files = {
    docx: await renderDocument(built.sheet, "docx", version, "rule_sheet"),
    pdf: await renderDocument(built.sheet, "pdf", version, "rule_sheet"),
  };
  const exportReport = await inspectOperationalExports(
    built.candidate,
    files,
    RULE_SHEET_NOTICE,
    built.sheet,
  );
  const { bundle } = reviewedRuleBundle(built, exportReport);
  const reasons = unique([
    ...built.holds,
    ...guideOpenReasons(evaluatePublication(bundle, now)),
    ...(exportReport.passed ? [] : ["export_inspection_failed"]),
  ]);
  const outcome = {
    rule: ruleId,
    requirementVersionId: prepared.rule.requirementVersionId,
    version,
    candidateHash: built.candidate.hash,
    policyHash: policy.hash,
    sourceCheckDate: built.candidate.sourceCheckDate,
    reviewBy: built.candidate.reviewBy!,
    failedChecks: built.mechanicalChecks.filter((c) => c.result !== "pass").map((c) => c.name),
    restores: restoring?.restores.version ?? null,
  };
  // Not ready: something other than the two reviews holds it. Nothing is kept.
  if (reasons.length) return { ...outcome, state: "held" as const, reasons, candidateArtifact: null };

  const provenance = await putPublicationArtifact(
    Buffer.from(JSON.stringify(repositoryRuleProvenance(prepared, restoring?.restores))),
    "json",
  );
  const exports = {
    docx: await putPublicationArtifact(files.docx, "docx"),
    pdf: await putPublicationArtifact(files.pdf, "pdf"),
  };
  const report = await putPublicationArtifact(Buffer.from(JSON.stringify(exportReport)), "json");
  const versionId = randomUUID();
  const candidateArtifact = await savePreparedCandidate({
    kind: "valo-prepared-candidate-v1",
    versionId,
    templateId: prepared.rule.requirementVersionId,
    version,
    // A rule has no page of its own; its candidate is found by the rule's id.
    slug: ruleId,
    policyId: policy.version,
    candidateHash: built.candidate.hash,
    bundle,
    attestations: {
      // Each source, by its id in the candidate, and the capture it is bound to.
      sourceSnapshots: built.snapshotIds,
      // Where each source's passage was read from, so that the rule can be built again from its own
      // sources for its reviews.
      passages: built.passages,
      provenance,
      exports,
      exportReport: report,
      reviews: [],
    },
    reviewBy: built.candidate.reviewBy!,
    preparedAt: now.toISOString(),
  });
  // The artifact is the candidate; this row only lets staff find it in the Content area. It is added on
  // drafting's own connection, as the drafter role: the database takes it from no other.
  await drafterDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    await tx.insert(valoPreparedCandidates).values({
      artifactId: candidateArtifact.id,
      artifactHash: candidateArtifact.hash,
      versionId,
      templateId: prepared.rule.requirementVersionId,
      version,
      candidateHash: built.candidate.hash,
      preparedAt: now,
      reviewBy: new Date(built.candidate.reviewBy!),
    });
  });
  return { ...outcome, state: "awaiting_reviews" as const, reasons: [], id: versionId, candidateArtifact };
}

const artifactRef = z
  .object({
    id: z.string().regex(/^[a-f0-9-]{36}$/),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    extension: z.enum(["json", "docx", "pdf"]),
  })
  .strict();
/** What a rule's prepared candidate keeps of its evidence. */
const ruleAttestations = z
  .object({
    sourceSnapshots: z.record(z.string(), z.string()),
    passages: z.array(
      z
        .object({
          sourceId: z.string(),
          id: z.string(),
          recordedLocator: z.string(),
          sections: z.array(z.string()),
          instrument: z.custom<GuideInstrument>((v) => typeof v === "object" && v !== null),
        })
        .strict(),
    ),
    provenance: artifactRef,
    exports: z.object({ docx: artifactRef, pdf: artifactRef }).strict(),
    exportReport: artifactRef,
    reviews: z.array(z.unknown()).length(0),
  })
  .strict();

/**
 * A rule's prepared candidate, read back and checked before its reviews are admitted or sent: the kept
 * artifact must be a prepared rule's, not past its review date, and no version of the rule stored
 * under its number on either route. Each capture its sources are bound to must still be the current one,
 * checked within the last day and holding the words the rule quotes, as its release will require. It is
 * built again from the repository's rule and its own sources, the captures they were bound to and the
 * passages read from them, under the guidance policy as it stands, and must be exactly what is kept: its
 * candidate, sources, rights record, checks, files and manifest. Its files are inspected again. Nothing
 * is written and no model is called. It reads private storage, so it runs outside any transaction.
 */
export async function readReviewedRuleReadiness(
  binding: {
    candidateVersionId: string;
    candidateArtifact: { id: string; hash: string; extension: "json"; templateId: string };
  },
  options: Omit<Options, "captures"> = {},
) {
  if (!/^[a-f0-9-]{36}$/.test(binding.candidateVersionId)) throw Error("CANDIDATE_VERSION_REQUIRED");
  const row = await readPreparedCandidate(binding.candidateArtifact);
  if (
    row.versionId !== binding.candidateVersionId ||
    row.templateId !== binding.candidateArtifact.templateId ||
    !isPreparedRuleId(row.templateId)
  )
    throw Error("CANDIDATE_BINDING_CHANGED");
  const now = options.now ?? new Date();
  if (Date.parse(row.reviewBy) <= +now) throw Error("CANDIDATE_UNAVAILABLE_OR_STALE");
  const repository = (options.candidates ?? ownerRuleCandidates).find(
    (c) => c.rule.requirementVersionId === row.templateId,
  );
  if (!repository || repository.rule.id !== row.slug) throw Error("CANDIDATE_REQUEST_PREPARER_UNAVAILABLE");
  const bundle = publicationSchema.parse(row.bundle),
    a = ruleAttestations.parse(row.attestations);
  // How the rule was written, as its candidate keeps it. A restore names the stored version whose words,
  // condition and calculation it releases again; the rule is built again from that version as stored.
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString()) as {
    restores?: RestoredVersion;
  };
  const restoring = provenance.restores
    ? await storedVersionToRestore(repository, provenance.restores.version)
    : null;
  if (restoring && restoring.restores.manifestHash !== provenance.restores?.manifestHash)
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  const prepared = restoring?.prepared ?? repository;
  if (
    bundle.candidate.id !== row.templateId ||
    bundle.candidate.version !== row.version ||
    bundle.candidate.hash !== row.candidateHash ||
    candidateDigest(bundle.candidate) !== row.candidateHash
  )
    throw Error("CANDIDATE_BINDING_CHANGED");
  // A version of the rule stored under its number, on either route, ends its review.
  const { db } = await import("@workspace/db");
  const taken = await db.execute(
    sql`select 1 from valo_rule_releases where rule_id = ${prepared.rule.id} and version = ${row.version} limit 1`,
  );
  if (taken.rows.length) throw Error("CANDIDATE_ALREADY_SAVED");
  // The release's own check of its sources: each bound capture is still the current copy of its official
  // source, checked within the last day, and holds the passage and every quotation.
  await verifyReleasedSources(db, bundle, a.sourceSnapshots, now);

  // The captures its sources were bound to, and the passages read from them, as the candidate keeps them.
  const captures = bundle.sources.flatMap((s) => {
    const source = prepared.sources.find((x) => x.id === s.id),
      read = a.passages.find((p) => p.sourceId === s.id),
      snapshotId = a.sourceSnapshots[s.id];
    return source && read && snapshotId
      ? [{ leadId: source.leadId, url: s.url, snapshotId, checkedAt: s.retrievedAt }]
      : [];
  });
  const passages: GuidePassages = (id) => {
    const read = a.passages.find((p) => p.id === id),
      source = read && bundle.sources.find((s) => s.id === read.sourceId);
    return read && source
      ? {
          id: read.id,
          recordedLocator: read.recordedLocator,
          sections: read.sections,
          instrument: read.instrument,
          text: source.text,
          hash: source.hash,
        }
      : undefined;
  };
  const { policy } = await guidancePolicy();
  const built = buildReviewedRule(prepared, {
    version: row.version,
    captures,
    passages,
    records: options.records ?? guideAmendmentRecords,
    policy,
    now,
  });
  const files = {
    docx: await getPublicationArtifact(a.exports.docx),
    pdf: await getPublicationArtifact(a.exports.pdf),
  };
  const exportReport = await inspectOperationalExports(
    built.candidate,
    files,
    RULE_SHEET_NOTICE,
    built.sheet,
  );
  const kept = JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
  if (!exportReport.passed || digest(exportReport) !== digest(kept))
    throw Error("SAVED_EXPORT_CHECK_CHANGED");
  const rebuilt = reviewedRuleBundle(built, exportReport);
  if (built.holds.length || digest(rebuilt.bundle) !== digest(bundle))
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  // Nothing but its two reviews may hold it now, as when it was kept.
  if (guideOpenReasons(evaluatePublication(bundle, now)).length) throw Error("SAVED_PLAN_MECHANICAL_HOLD");
  if (digest(provenance) !== digest(repositoryRuleProvenance(prepared, restoring?.restores)))
    throw Error("SAVED_PLAN_INPUT_CHANGED");

  const serverEvidence: RuleServerEvidence = {
    candidateHash: bundle.candidate.hash,
    policyHash: policy.hash,
    sourceCheckedAt: bundle.candidate.sourceCheckDate,
    ruleId: prepared.rule.id,
    version: row.version,
    sourceSnapshots: a.sourceSnapshots,
    provenanceArtifactHash: a.provenance.hash,
    exportReportArtifactHash: a.exportReport.hash,
    authoringRoute: "repository-rule",
    sourceAttribution: "Written in the repository; no independently recorded drafting model or run",
    performedChecks: bundle.mechanicalChecks.map((c) => c.name),
  };
  const reviewInputs: RuleReviewInputs = {
    rights: bundle.rights,
    provenance,
    exports: exportReport.formats,
    // What the requirements check gives for each scenario, beside what the rule expects.
    scenarios: ruleScenarioResults(prepared, built.rule, now).map((result) => ({
      ...result,
      facts: prepared.scenarios.find((s) => s.id === result.id)?.facts,
      asOfDate: prepared.scenarios.find((s) => s.id === result.id)?.asOfDate,
    })),
  };
  return {
    row,
    prepared,
    bundle,
    candidate: bundle.candidate,
    rule: built.rule,
    // The rule built again and its files' inspection, from which its bundle is made once its reviews
    // have run (slice 3b).
    built,
    exportReport,
    serverEvidence,
    reviewInputs,
    // The stored version this candidate restores, if it is a restore (ADM-004).
    restores: restoring?.restores ?? null,
  };
}
