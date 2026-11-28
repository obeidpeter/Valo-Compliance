import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  invoiceQuotationGuideIds,
  isPracticalGuideId,
  isPreparedRuleId,
  preparedRuleIds,
  reminderInventoryGuideIds,
} from "@workspace/valo-core";
import { createHash } from "node:crypto";
import {
  additionalInferenceAllocation,
  inferenceProposal,
  inferenceTimestamp,
  tokenCost,
  requestDigest,
} from "./inference-budget";
import type { FiniteManifest, FiniteWork } from "./inference-types";
import type { InferenceBudgetStore } from "./inference-budget-store";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  industryDraftPath,
  practicalDraftPath,
  retainedContentSections,
  type NamedContentSection,
} from "../../lib/retained-content-sections";
import {
  mappedGuideIds,
  operationalInferenceTemplateIds,
  supportsOperationalInferenceTemplate,
} from "../publication";
const root = resolve(import.meta.dirname, "../../../../..");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type SourceRef = { path: string; sha256: string };
export type FiniteAllocationPackage = {
  version: 3;
  kind: "finite-inference-package";
  preparedAt: string;
  policyVersion: string;
  allocation: typeof additionalInferenceAllocation;
  sourceFiles: SourceRef[];
  contentIds: string[];
  namedContentSections: NamedContentSection[];
  corpora: { name: "editorial" | "checker" | "customer-ai"; cases: { id: string; hash: string }[] }[];
  laneAttemptLimits: { publication: 216; editorial_evaluation: 68; checker_challenge: 80; customer: 94 };
  allowedRoles: readonly ["factual", "challenge", "customer"];
  supportedPreparers: FinitePackagePreparers;
  holds: string[];
};
/**
 * The request preparers a package admits work from. A package names exactly one set, so each owner
 * approval covers one kind of work: the template review pairs (with the customer cases the
 * original package already covered), the case-bound editorial cases (decision 0015), the review
 * pairs of guides that say what the law requires (decision 0017), the challenges of the
 * requirements check's frozen scenarios (RUL-008), or the review pairs of requirements-check rules
 * prepared for the reviewed route (docs/architecture/reviewed-route.md, part 3).
 */
export const finitePackagePreparers = {
  templatePairs: ["operational-template-pair-v1"],
  editorialCases: ["editorial-case-pair-v1"],
  checkerChallenges: ["checker-challenge-v1"],
  guidePairs: ["guide-review-pair-v1"],
  practicalPairs: ["practical-business-guide-pair-v1"],
  reminderInventoryPairs: ["practical-reminder-inventory-pair-v1"],
  rulePairs: ["rule-review-pair-v1"],
} as const;
export type FinitePackagePreparers = (typeof finitePackagePreparers)[keyof typeof finitePackagePreparers];
/**
 * What a package of guide reviews holds to. The publisher releases a guide only after the development
 * owner's own check of its sources (decision 0018), so a guide's pair is admitted, and sent, only once the
 * owner has checked that exact candidate within the last day (docs/architecture/reviewed-route.md, part 2).
 * The dispatcher's binding check asks for it before admission and again before dispatch.
 */
export const guideReviewsNeedOwnerCheck =
  "A guide's review pair is admitted and sent only once the development owner has checked that exact candidate's official sources within the last day, and the publisher releases the guide only on such a check of it.";
const preparerSet = (value: unknown) =>
  Object.values(finitePackagePreparers).find((set) => requestDigest(set) === requestDigest(value));
function reviewLimits(articleIds: readonly string[]) {
  const maximumCalls = articleIds.length * 2;
  return {
    articleIds,
    maximumCalls,
    maximumReservationNanoUsd: (
      BigInt(maximumCalls) *
      tokenCost(inferenceProposal.fallback.inputTokens, inferenceProposal.fallback.outputTokens)
    ).toString(),
  };
}
export const practicalReviewLimits = reviewLimits(invoiceQuotationGuideIds);
const reminderInventoryReviewLimits = reviewLimits(reminderInventoryGuideIds);
/** Source files contain all twelve drafts. Only the selected preparer's two IDs can be admitted. */
export function practicalReviewLimitsFor(preparers: FinitePackagePreparers) {
  const selected = preparerSet(preparers);
  if (selected === finitePackagePreparers.practicalPairs) return practicalReviewLimits;
  if (selected === finitePackagePreparers.reminderInventoryPairs) return reminderInventoryReviewLimits;
  return undefined;
}
const scopePaths = [
  "docs/registers/content-inventory.json",
  "docs/content-candidates/r1-content-intake-manifest.json",
  "docs/evaluation-candidates/editorial.json",
  "docs/evaluation-candidates/checker.json",
  "docs/evaluation-candidates/customer-ai.json",
  practicalDraftPath,
  industryDraftPath,
] as const;
function namedSections(path: string, body: string) {
  return retainedContentSections(path, body).map(({ section }) => section);
}
/** Reads the actual finite inventory/corpora. Scope is not readiness: unfinished
 * preparers remain held, and actual source/rights/currentness gates still run. */
export async function prepareFiniteAllocationPackage(
  now = new Date(),
  preparers: FinitePackagePreparers = finitePackagePreparers.templatePairs,
): Promise<FiniteAllocationPackage> {
  const selected = preparerSet(preparers);
  if (!selected) throw Error("PACKAGE_PREPARERS_INVALID");
  const editorialCases = selected === finitePackagePreparers.editorialCases;
  const checkerChallenges = selected === finitePackagePreparers.checkerChallenges;
  const guidePairs = selected === finitePackagePreparers.guidePairs;
  const rulePairs = selected === finitePackagePreparers.rulePairs;
  const practical = practicalReviewLimitsFor(selected);
  const sources = await Promise.all(
    scopePaths.map(async (path) => {
      const bytes = await readFile(resolve(root, path));
      return {
        path,
        sha256: sha(bytes),
        body: bytes.toString(),
        value: path.endsWith(".json") ? JSON.parse(bytes.toString()) : null,
      };
    }),
  );
  const intake = sources[1]!.value as { templates: { id: string }[]; guidance: { id: string }[] };
  const corpora = sources.slice(2, 5).map((source) => {
    const name = source.path
      .split("/")
      .at(-1)!
      .replace(".json", "") as FiniteAllocationPackage["corpora"][number]["name"];
    const cases = (source.value as { cases: Record<string, unknown>[] }).cases.map((row) => {
      const id = row.id ?? row.caseID ?? row.caseId ?? row.scenarioId ?? row.scenarioID;
      if (typeof id !== "string" || !id) throw Error("PACKAGE_CORPUS_ID_INVALID");
      return { id, hash: requestDigest(row) };
    });
    if (
      cases.length !== { editorial: 60, checker: 80, "customer-ai": 60 }[name] ||
      new Set(cases.map((c) => c.id)).size !== cases.length
    )
      throw Error("PACKAGE_CORPUS_CHANGED");
    return { name, cases };
  });
  const sections = sources.slice(5).flatMap((source) => namedSections(source.path, source.body));
  for (const [category, count] of Object.entries({
    "practical-guide": 12,
    "industry-landing": 20,
    "industry-deeper-pack": 6,
  }))
    if (sections.filter((s) => s.category === category).length !== count)
      throw Error("PACKAGE_CONTENT_SECTIONS_CHANGED");
  return {
    version: 3,
    kind: "finite-inference-package",
    preparedAt: now.toISOString(),
    policyVersion: inferenceProposal.priceVersion,
    allocation: { ...additionalInferenceAllocation },
    sourceFiles: sources.map(({ path, sha256 }) => ({ path, sha256 })),
    contentIds: [...new Set([...intake.templates, ...intake.guidance].map((c) => c.id))].sort(),
    namedContentSections: sections,
    corpora,
    laneAttemptLimits: { publication: 216, editorial_evaluation: 68, checker_challenge: 80, customer: 94 },
    allowedRoles: ["factual", "challenge", "customer"],
    supportedPreparers: [...preparers] as unknown as FinitePackagePreparers,
    holds: practical
      ? [
          `One factual review and one independent challenge per article, for ${practical.articleIds.join(" and ")} only.`,
          "Four provider calls at most. Each article can be admitted once. No retries or other work are covered.",
        ]
      : checkerChallenges
        ? [
            "Supported checker challenges: one request for each frozen scenario of a requirements-check rule released on the owner's sign-off; each is rebuilt from that release at its own moment and rechecked before admission and dispatch.",
            "An answer challenges a scenario's expected result. It accepts nothing and is not professional review.",
            "Template review pairs, editorial cases, guides, customer cases and other content are outside this package.",
            "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt.",
          ]
        : editorialCases
          ? [
              "Supported editorial case pairs: the case-bound editorial cases whose candidates are built from retained text; each pair is rebuilt from the pinned files and rechecked before admission and dispatch.",
              "Template review pairs, customer cases, other content and other evaluation lanes are outside this package.",
              "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt.",
            ]
          : rulePairs
            ? [
                `Supported rule review pairs: ${preparedRuleIds.join(", ")}; each requires a rule prepared in the repository and built for the reviewed route from current captures of its official sources, under the guidance policy as the owner approved it and with a rights record the owner chose for that route.`,
                "Each pair is built again from the rule's own sources and records and checked before admission and dispatch. A review is an AI check, never legal, tax or regulatory review.",
                "Template review pairs, guides, editorial cases, checker challenges, customer cases and other content are outside this package.",
                "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt.",
              ]
            : guidePairs
              ? [
                  `Supported guide review pairs: ${mappedGuideIds.join(", ")}; each requires a prepared candidate bound to current captures of its official sources, under the guidance policy as the owner approved it.`,
                  guideReviewsNeedOwnerCheck,
                  "Template review pairs, editorial cases, customer cases and other content are outside this package.",
                  "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt.",
                ]
              : [
                  `Supported exact operational preparers: ${operationalInferenceTemplateIds.join(", ")}; each requires a saved candidate and verified private evidence.`,
                  "Other content and all evaluation lanes require their real request preparers and eligibility checks before delegated admission.",
                  "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt.",
                ],
  };
}
export function allocationPackageId(value: FiniteAllocationPackage) {
  return `finite-package:${requestDigest(value)}`;
}
/** Validates the frozen content identities and case rosters only. This is not
 * admission authority: it accepts historical packages whose allocation terms are
 * superseded, so callers that admit or dispatch work must use validateAllocationPackage. */
export function validatePackageScope(value: FiniteAllocationPackage) {
  if (
    value.version !== 3 ||
    value.kind !== "finite-inference-package" ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    !Array.isArray(value.contentIds) ||
    !value.contentIds.length ||
    new Set(value.contentIds).size !== value.contentIds.length ||
    value.sourceFiles.length !== scopePaths.length ||
    value.sourceFiles.some((f, i) => f.path !== scopePaths[i] || !/^[a-f0-9]{64}$/.test(f.sha256))
  )
    throw Error("ALLOCATION_PACKAGE_INVALID");
  if (
    !Array.isArray(value.namedContentSections) ||
    value.namedContentSections.length !== 38 ||
    new Set(value.namedContentSections.map((s) => s.identity)).size !== 38 ||
    value.namedContentSections.some(
      (s) =>
        (s.sourcePath !== scopePaths[5] && s.sourcePath !== scopePaths[6]) ||
        s.identity !== `${s.sourcePath}#${s.heading}` ||
        !/^[a-f0-9]{64}$/.test(s.baselineSectionSha256),
    )
  )
    throw Error("ALLOCATION_PACKAGE_INVALID");
  for (const [name, count] of Object.entries({ editorial: 60, checker: 80, "customer-ai": 60 })) {
    const corpus = value.corpora.filter((c) => c.name === name);
    if (
      corpus.length !== 1 ||
      corpus[0]!.cases.length !== count ||
      new Set(corpus[0]!.cases.map((c) => c.id)).size !== count ||
      corpus[0]!.cases.some((c) => !c.id || !/^[a-f0-9]{64}$/.test(c.hash))
    )
      throw Error("ALLOCATION_PACKAGE_INVALID");
  }
}
/** Full validation for admission: the frozen scope plus the current allocation,
 * policy version, lane ceilings and allowed roles. */
export function validateAllocationPackage(value: FiniteAllocationPackage) {
  validatePackageScope(value);
  if (
    value.policyVersion !== inferenceProposal.priceVersion ||
    requestDigest(value.allocation) !== requestDigest(additionalInferenceAllocation) ||
    requestDigest(value.laneAttemptLimits) !==
      requestDigest({ publication: 216, editorial_evaluation: 68, checker_challenge: 80, customer: 94 }) ||
    requestDigest(value.allowedRoles) !== requestDigest(["factual", "challenge", "customer"]) ||
    !preparerSet(value.supportedPreparers)
  )
    throw Error("ALLOCATION_PACKAGE_INVALID");
}
/** The template a publication work reviews, from its prepared candidate's binding (decision 0014). */
function workContentId(work: FiniteWork) {
  return work.lane === "publication" ? (work.bindings.candidateArtifact?.templateId ?? null) : null;
}
export function assertWorkPackageMembership(
  work: FiniteWork,
  pkg: FiniteAllocationPackage,
  contentId: string | null,
) {
  validateAllocationPackage(pkg);
  if (!pkg.allowedRoles.includes(work.role) || (work.role === "customer" && work.lane !== "customer"))
    throw Error("WORK_OUTSIDE_PACKAGE");
  const practical = practicalReviewLimitsFor(pkg.supportedPreparers);
  if (practical) {
    const source = pkg.sourceFiles.find((file) => file.path === scopePaths[5]);
    if (
      !contentId ||
      !practical.articleIds.includes(contentId) ||
      workContentId(work) !== contentId ||
      !work.pair ||
      !["factual", "challenge"].includes(work.role) ||
      work.retryOf !== undefined ||
      !work.bindings.candidateVersionId ||
      !work.bindings.operationalPlan ||
      work.bindings.caseId !== null ||
      work.bindings.corpus !== null ||
      !source ||
      requestDigest(work.bindings.sourceFiles) !== requestDigest([source]) ||
      !pkg.namedContentSections.some(
        (s) =>
          s.category === "practical-guide" &&
          s.sourcePath === source.path &&
          s.heading.startsWith(contentId + " — "),
      )
    )
      throw Error("WORK_OUTSIDE_PACKAGE");
    return;
  }
  if (contentId && isPracticalGuideId(contentId)) throw Error("WORK_OUTSIDE_PACKAGE");
  // A rule package admits the review pairs of the rules prepared in the repository and nothing else, and
  // no other package admits a rule's pair. The binding checks build each pair again from the rule's own
  // sources and records before admission and dispatch (docs/architecture/reviewed-route.md, part 3).
  const rulePairs = requestDigest(pkg.supportedPreparers) === requestDigest(finitePackagePreparers.rulePairs);
  if (Boolean(contentId && isPreparedRuleId(contentId)) !== rulePairs) throw Error("WORK_OUTSIDE_PACKAGE");
  if (rulePairs) {
    if (
      work.lane !== "publication" ||
      !contentId ||
      workContentId(work) !== contentId ||
      !work.pair ||
      !["factual", "challenge"].includes(work.role) ||
      work.retryOf !== undefined ||
      !work.bindings.candidateVersionId ||
      !work.bindings.operationalPlan ||
      work.bindings.caseId !== null ||
      work.bindings.corpus !== null
    )
      throw Error("WORK_OUTSIDE_PACKAGE");
    return;
  }
  // An editorial-case package admits its case pairs and nothing else; no other package admits them.
  // The binding checks rebuild each pair from the case preparer before admission and dispatch.
  const editorialCases =
    requestDigest(pkg.supportedPreparers) === requestDigest(finitePackagePreparers.editorialCases);
  if (editorialCases !== (work.lane === "editorial_evaluation")) throw Error("WORK_OUTSIDE_PACKAGE");
  // A checker-challenge package admits the challenges of the frozen scenarios and nothing else; no
  // other package admits them. The binding checks rebuild each from its release (RUL-008).
  const checkerChallenges =
    requestDigest(pkg.supportedPreparers) === requestDigest(finitePackagePreparers.checkerChallenges);
  if (checkerChallenges !== (work.lane === "checker_challenge")) throw Error("WORK_OUTSIDE_PACKAGE");
  // A guide package admits the review pairs of guides and nothing else, and no other package
  // admits a guide: the owner approves spending on guides by approving a package of this kind.
  const guidePairs =
    requestDigest(pkg.supportedPreparers) === requestDigest(finitePackagePreparers.guidePairs);
  if (guidePairs && work.lane !== "publication") throw Error("WORK_OUTSIDE_PACKAGE");
  if (work.bindings.corpus) {
    const corpus = pkg.corpora.find((c) => c.name === work.bindings.corpus),
      row = corpus?.cases.find((c) => c.id === work.bindings.caseId);
    if (!row || row.hash !== work.caseHash) throw Error("WORK_OUTSIDE_PACKAGE");
  }
  if (work.lane === "publication" && (!contentId || !pkg.contentIds.includes(contentId)))
    throw Error("WORK_OUTSIDE_PACKAGE");
  // Both customer preparation routes (case selection and saved customer plans) produce
  // single-role works with no review pair or candidate version.
  if (
    work.lane === "customer" &&
    work.role === "customer" &&
    work.pair === null &&
    work.bindings.corpus === "customer-ai" &&
    work.bindings.candidateVersionId === null &&
    !contentId
  )
    return;
  if (editorialCases) {
    if (work.bindings.corpus !== "editorial" || !work.pair || contentId)
      throw Error("PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE");
    return;
  }
  if (checkerChallenges) {
    if (
      work.bindings.corpus !== "checker" ||
      work.pair !== null ||
      work.role !== "challenge" ||
      !work.bindings.candidateVersionId ||
      contentId
    )
      throw Error("PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE");
    return;
  }
  // Scope may authorize these lanes, but scope alone cannot manufacture an
  // implemented safe request preparer or weaken the actual readiness checks.
  if (
    work.lane !== "publication" ||
    !contentId ||
    !(guidePairs ? mappedGuideIds.includes(contentId) : supportsOperationalInferenceTemplate(contentId)) ||
    !work.bindings.operationalPlan
  )
    throw Error("PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE");
  // A guide's pair is complete here. The owner's check of its sources is asked for by the binding check
  // the dispatcher makes before admission and dispatch (guideReviewsNeedOwnerCheck).
}
async function packageRow(c: import("pg").PoolClient, schema: string, id: string, admitting: boolean) {
  const row = (await c.query(`SELECT * FROM "${schema}".valo_inference_batches WHERE id=$1 FOR SHARE`, [id]))
    .rows[0];
  if (
    !row ||
    !row.approved_by ||
    row.approved_by === "finite-package-delegate" ||
    !row.approval_reference ||
    !row.approved_at ||
    (admitting && !row.enabled)
  )
    throw Error("ALLOCATION_PACKAGE_NOT_AUTHORIZED");
  const pkg = row.manifest as FiniteAllocationPackage;
  validateAllocationPackage(pkg);
  const approvedAt = inferenceTimestamp(row.approved_at),
    expiresAt = inferenceTimestamp(row.expires_at);
  if (
    row.policy_hash !== requestDigest(inferenceProposal) ||
    row.manifest_hash !== requestDigest(pkg) ||
    id !== allocationPackageId(pkg) ||
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > Date.now() ||
    Date.parse(pkg.preparedAt) > approvedAt ||
    (admitting && expiresAt <= Date.now())
  )
    throw Error("ALLOCATION_PACKAGE_EXPIRED_OR_CHANGED");
  if (admitting) {
    const actual = await Promise.all(
      pkg.sourceFiles.map(async (source) => ({ source, bytes: await readFile(resolve(root, source.path)) })),
    );
    // The original evaluation oracle remains byte-pinned. Content scope is
    // its named identity; routine same-identity candidate revisions still need
    // full real readiness checks but do not require another spending approval.
    for (const { source, bytes } of actual.slice(2, 5))
      if (sha(bytes) !== source.sha256) throw Error("ALLOCATION_PACKAGE_SOURCE_CHANGED");
    const intake = JSON.parse(actual[1]!.bytes.toString()) as {
      templates: { id: string }[];
      guidance: { id: string }[];
    };
    const ids = new Set([...intake.templates, ...intake.guidance].map((x) => x.id));
    if (pkg.contentIds.some((id) => !ids.has(id))) throw Error("ALLOCATION_PACKAGE_CONTENT_IDENTITY_CHANGED");
    const sections = actual.slice(5).flatMap((x) => namedSections(x.source.path, x.bytes.toString()));
    const practical = practicalReviewLimitsFor(pkg.supportedPreparers);
    if (
      practical &&
      (sha(actual[5]!.bytes) !== actual[5]!.source.sha256 ||
        practical.articleIds.some((id) => {
          const section = pkg.namedContentSections.find((s) => s.heading.startsWith(id + " — "));
          return (
            !section ||
            !sections.some(
              (current) =>
                current.identity === section.identity &&
                current.baselineSectionSha256 === section.baselineSectionSha256,
            )
          );
        }))
    )
      throw Error("ALLOCATION_PACKAGE_SOURCE_CHANGED");
    if (pkg.namedContentSections.some((s) => !sections.some((current) => current.identity === s.identity)))
      throw Error("ALLOCATION_PACKAGE_CONTENT_IDENTITY_CHANGED");
  }
  return { row, pkg };
}
/** Reuse the existing immutable package for fresh exact submanifests. A new
 * child timestamp never creates a new owner-approval requirement. */
export async function readApprovedFiniteAllocationPackage(
  pool: Pick<import("pg").Pool, "connect">,
  id: string,
  schema = "public",
) {
  assertDevelopmentRuntime();
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error("INVALID_LEDGER_SCHEMA");
  const c = await pool.connect();
  // PostgreSQL row locks require an ordinary transaction. This path performs
  // only reads; it neither writes approval nor modifies the package.
  try {
    await c.query("BEGIN");
    const { pkg, row } = await packageRow(c, schema, id, true);
    await c.query("COMMIT");
    return { pkg, expiresAt: new Date(row.expires_at).toISOString() };
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
function practicalPairId(pkg: FiniteAllocationPackage, works: FiniteWork[]) {
  if (!practicalReviewLimitsFor(pkg.supportedPreparers)) return null;
  const [first, second] = works;
  if (
    works.length !== 2 ||
    !first ||
    !second ||
    !first.pair ||
    first.pair !== second.pair ||
    first.role === second.role ||
    first.candidateHash !== second.candidateHash ||
    !first.bindings.candidateArtifact ||
    requestDigest(first.bindings) !== requestDigest(second.bindings)
  )
    throw Error("PRACTICAL_GUIDE_REVIEW_PAIR_REQUIRED");
  return first.bindings.candidateArtifact.templateId;
}
export async function assertDelegatedBatchAuthority(
  c: import("pg").PoolClient,
  schema: string,
  child: {
    manifest: FiniteManifest;
    manifest_hash: string;
    approved_by: string;
    approval_reference: string;
    approved_at: unknown;
    expires_at: unknown;
  },
  admitting = true,
) {
  const id = child.manifest.packageId;
  if (!id) throw Error("ALLOCATION_PACKAGE_REQUIRED");
  const { row, pkg } = await packageRow(c, schema, id, admitting);
  if (
    child.approved_by !== "finite-package-delegate" ||
    child.approval_reference !==
      `delegate:${requestDigest({
        packageId: id,
        packageHash: row.manifest_hash,
        manifestHash: child.manifest_hash,
      })}` ||
    inferenceTimestamp(child.approved_at) < inferenceTimestamp(row.approved_at) ||
    inferenceTimestamp(child.expires_at) > inferenceTimestamp(row.expires_at)
  )
    throw Error("DELEGATED_APPROVAL_BINDING_INVALID");
  if (admitting) {
    practicalPairId(pkg, child.manifest.works);
    for (const work of child.manifest.works) {
      assertWorkPackageMembership(work, pkg, workContentId(work));
    }
  }
  return pkg;
}
/** Server-only automatic admission inside a previously owner-approved finite
 * package. It cannot create/enable the parent approval or reset its ledger. */
export async function registerPreparedInferenceSubmanifest(
  store: InferenceBudgetStore,
  manifest: FiniteManifest,
  expiresAt: string,
  recheck: (work: FiniteWork) => Promise<void>,
) {
  assertDevelopmentRuntime();
  if (!manifest.packageId || store.allocationId() !== additionalInferenceAllocation.id)
    throw Error("DELEGATED_REGISTRATION_HELD");
  // Admitted exactly as checked: the caller cannot change the manifest while the checks wait.
  const admitted = structuredClone(manifest),
    packageId = manifest.packageId,
    manifestHash = requestDigest(admitted),
    batchId = `finite-submanifest:${manifestHash}`;
  // The binding checks read retained files, saved versions and private artifacts, and take pooled
  // connections of their own, so they run before the ledger transaction, never while it holds the
  // allocation lock. They confirm each candidate artifact holds a version of its template, which
  // the membership check below relies on.
  for (const work of admitted.works) await recheck(work);
  return store.mutate("finite-submanifest-admitted", async (s, c) => {
    const { row, pkg } = await packageRow(c, store.schemaName(), packageId, true);
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > inferenceTimestamp(row.expires_at))
      throw Error("SUBMANIFEST_EXPIRY_INVALID");
    for (const work of admitted.works) assertWorkPackageMembership(work, pkg, workContentId(work));
    const article = practicalPairId(pkg, admitted.works);
    if (article) {
      // store.mutate holds the allocation row lock until commit, including concurrent admissions.
      const earlier = await c.query(
        `SELECT 1 FROM "${store.schemaName()}".valo_inference_batches
         WHERE manifest->>'packageId'=$1 AND manifest_hash<>$2
           AND manifest->'works'->0->'bindings'->'candidateArtifact'->>'templateId'=$3 LIMIT 1`,
        [packageId, manifestHash, article],
      );
      if (earlier.rowCount) throw Error("PRACTICAL_GUIDE_PAIR_ALREADY_ADMITTED");
    }
    const reference = `delegate:${requestDigest({ packageId, packageHash: row.manifest_hash, manifestHash })}`;
    await c.query(
      `INSERT INTO "${store.schemaName()}".valo_inference_batches
      (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
      VALUES($1,$2,$3,$4,true,'finite-package-delegate',$5,now(),$6) ON CONFLICT(id) DO NOTHING`,
      [
        batchId,
        requestDigest(inferenceProposal),
        manifestHash,
        JSON.stringify(admitted),
        reference,
        expiresAt,
      ],
    );
    const saved = (
      await c.query(`SELECT * FROM "${store.schemaName()}".valo_inference_batches WHERE id=$1 FOR SHARE`, [
        batchId,
      ])
    ).rows[0];
    if (
      !saved ||
      saved.manifest_hash !== manifestHash ||
      requestDigest(saved.manifest) !== manifestHash ||
      !saved.enabled
    )
      throw Error("SUBMANIFEST_REGISTRATION_CONFLICT");
    await assertDelegatedBatchAuthority(c, store.schemaName(), saved);
    return { state: s, value: { batchId, manifestHash, packageId, providerCalls: 0 } };
  });
}

/** The longest approval the owner can record: the decision packet proposes 24 hours from approval. */
export const MAX_PACKAGE_APPROVAL_HOURS = 24;
const delegate = "finite-package-delegate";
// Printable text with no control characters, so a label reads the same in every log and listing.
const plainLabel = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && /^[\x20-\x7e]+$/.test(value) && value.trim() === value;
export type PackageApprovalRequest = {
  /** The package id the owner read and confirms; it must equal the package's own id. */
  confirmPackageId: string;
  /** Who approved the allocation. Never the marker that delegated children carry. */
  approvedBy: string;
  /** Where the approval is written down, such as a dated decision record. */
  reference: string;
  /** How long the approval lasts, in whole hours, at most MAX_PACKAGE_APPROVAL_HOURS. */
  hours: number;
};
export type RecordedPackageApproval = {
  packageId: string;
  enabled: boolean;
  approvedBy: string;
  reference: string;
  approvedAt: string;
  expiresAt: string;
};
const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const recorded = (row: Record<string, unknown>): RecordedPackageApproval => ({
  packageId: String(row.id),
  enabled: row.enabled === true,
  approvedBy: String(row.approved_by),
  reference: String(row.approval_reference),
  approvedAt: iso(row.approved_at),
  expiresAt: iso(row.expires_at),
});
async function inTransaction<T>(
  pool: Pick<import("pg").Pool, "connect">,
  fn: (c: import("pg").PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
const ledgerSchema = (schema: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error("INVALID_LEDGER_SCHEMA");
  return schema;
};

/**
 * Records the owner's approval of one exact finite allocation package: the start boundary of the
 * additional allocation. The package must pass full admission validation and its id must be the
 * one the owner confirms. The approval lasts at most 24 hours, only one package approval can be
 * current at a time, and the row is kept only if the dispatcher's own admission check accepts it
 * in the same transaction. Approving never adds money: every package draws on the one additional
 * allocation, whose ledger keeps each reservation and charge against its cap. Nothing here calls a
 * model, reserves budget or admits work, and the database trigger freezes the approval once written.
 */
export async function approveFiniteAllocationPackage(
  pool: Pick<import("pg").Pool, "connect">,
  pkg: FiniteAllocationPackage,
  request: PackageApprovalRequest,
  schema = "public",
): Promise<RecordedPackageApproval> {
  assertDevelopmentRuntime();
  ledgerSchema(schema);
  validateAllocationPackage(pkg);
  const id = allocationPackageId(pkg);
  if (request.confirmPackageId !== id) throw Error("PACKAGE_APPROVAL_NOT_CONFIRMED");
  if (
    !plainLabel(request.approvedBy, 3, 120) ||
    request.approvedBy === delegate ||
    request.approvedBy.startsWith("delegate:")
  )
    throw Error("PACKAGE_APPROVER_INVALID");
  if (!plainLabel(request.reference, 12, 300) || request.reference.startsWith("delegate:"))
    throw Error("PACKAGE_APPROVAL_REFERENCE_INVALID");
  if (!Number.isInteger(request.hours) || request.hours < 1 || request.hours > MAX_PACKAGE_APPROVAL_HOURS)
    throw Error("PACKAGE_APPROVAL_HOURS_INVALID");
  return inTransaction(pool, async (c) => {
    // Serializes approvals so two can never both find no current approval and both be recorded.
    await c.query("SELECT pg_advisory_xact_lock(747116)");
    const current = await c.query(
      `SELECT id FROM "${schema}".valo_inference_batches
       WHERE id LIKE 'finite-package:%' AND enabled AND approved_at IS NOT NULL AND expires_at > now()`,
    );
    if (current.rows.length) throw Error("ANOTHER_PACKAGE_APPROVAL_CURRENT");
    const inserted = await c.query(
      `INSERT INTO "${schema}".valo_inference_batches
       (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
       VALUES($1,$2,$3,$4,true,$5,$6,now(),now() + make_interval(hours => $7))
       ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        id,
        requestDigest(inferenceProposal),
        requestDigest(pkg),
        JSON.stringify(pkg),
        request.approvedBy,
        request.reference,
        request.hours,
      ],
    );
    // An approval is never extended, repeated or re-enabled: those need a new package.
    if (!inserted.rows.length) throw Error("PACKAGE_ALREADY_RECORDED");
    const { row } = await packageRow(c, schema, id, true);
    return recorded(row);
  });
}

/** Stops new work under an approved package at once: the dispatcher and every delegated child
 * recheck the parent before each dispatch. The trigger lets an approval be disabled, never re-enabled. */
export async function revokeFiniteAllocationPackage(
  pool: Pick<import("pg").Pool, "connect">,
  confirmPackageId: string,
  schema = "public",
): Promise<RecordedPackageApproval & { wasEnabled: boolean }> {
  assertDevelopmentRuntime();
  ledgerSchema(schema);
  if (!/^finite-package:[a-f0-9]{64}$/.test(confirmPackageId)) throw Error("PACKAGE_ID_INVALID");
  return inTransaction(pool, async (c) => {
    const [before] = (
      await c.query(
        `SELECT * FROM "${schema}".valo_inference_batches WHERE id=$1 AND approved_at IS NOT NULL FOR UPDATE`,
        [confirmPackageId],
      )
    ).rows;
    if (!before || before.approved_by === delegate) throw Error("APPROVED_PACKAGE_NOT_FOUND");
    const [after] = (
      await c.query(`UPDATE "${schema}".valo_inference_batches SET enabled=false WHERE id=$1 RETURNING *`, [
        confirmPackageId,
      ])
    ).rows;
    return { ...recorded(after), wasEnabled: before.enabled === true };
  });
}

/** Every recorded package approval, oldest first. Read-only. */
export async function listFiniteAllocationApprovals(
  pool: Pick<import("pg").Pool, "connect">,
  schema = "public",
): Promise<RecordedPackageApproval[]> {
  assertDevelopmentRuntime();
  ledgerSchema(schema);
  const c = await pool.connect();
  try {
    const rows = await c.query(
      `SELECT * FROM "${schema}".valo_inference_batches
       WHERE id LIKE 'finite-package:%' AND approved_at IS NOT NULL ORDER BY approved_at, id`,
    );
    return rows.rows.map(recorded);
  } finally {
    c.release();
  }
}
