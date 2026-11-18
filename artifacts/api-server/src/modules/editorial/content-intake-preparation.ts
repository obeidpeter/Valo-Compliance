import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, sha256 } from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { allocationPackageId, validatePackageScope, type FiniteAllocationPackage } from "../ai";
import { supportsOperationalInferenceTemplate } from "../../lib/inference-operational-coverage";
import { readTemplateIntake, readGuidanceIntake, publicationWorkspaceRoot } from "../publication";

const frozenPath = "docs/valo/evidence/finite-allocation-package-disabled.json";
export const frozenContentPackageId =
  "finite-package:3f21b47b43700024af042fa1284ed45503115a1f56dba2bd591d727a68df96a8";
const canonicalTemplates = new Set(
  Array.from({ length: 40 }, (_, i) => `TPL-${String(i + 1).padStart(2, "0")}`),
);
const canonicalGuidance = new Set(
  Array.from({ length: 30 }, (_, i) => `GUD-${String(i + 1).padStart(2, "0")}`),
);
export type ContentPreparationClass =
  | "operational_template"
  | "enhanced_template"
  | "unimplemented_template"
  | "regulatory_guidance"
  | "practical_guide"
  | "industry_landing"
  | "industry_pack";

/** Checks the retained proposal without replacing it or reading approval state.
 * File equality is a provenance boundary, never evidence of a content review. */
export async function readFrozenContentPackage(): Promise<FiniteAllocationPackage> {
  const root = publicationWorkspaceRoot(),
    frozen = JSON.parse(await readFile(resolve(root, frozenPath), "utf8"));
  const pkg = frozen.package as FiniteAllocationPackage;
  validatePackageScope(pkg);
  if (frozen.packageId !== frozenContentPackageId || allocationPackageId(pkg) !== frozenContentPackageId)
    throw Error("FROZEN_CONTENT_PACKAGE_CHANGED");
  for (const source of pkg.sourceFiles) {
    if (sha256(await readFile(resolve(root, source.path))) !== source.sha256)
      throw Error("FROZEN_CONTENT_SOURCE_CHANGED");
  }
  return pkg;
}

/** The exact named section is preserved separately. Internal status, source-lead
 * metadata and handoff headings cannot become customer prose through this path.
 * The supplied hash is the existing frozen section hash, not a new identity. */
export function extractNamedContentDraft(
  section: FiniteAllocationPackage["namedContentSections"][number],
  source: string,
) {
  const headers = [...source.matchAll(/^#{1,3} .+$/gm)];
  const selected = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h[0].replace(/^#+ /, "") === section.heading);
  if (selected.length !== 1) throw Error("FROZEN_NAMED_SECTION_NOT_UNIQUE");
  const { h, i } = selected[0]!,
    raw = source.slice(h.index, headers[i + 1]?.index ?? source.length);
  if (sha256(raw) !== section.baselineSectionSha256) throw Error("FROZEN_NAMED_SECTION_CHANGED");
  const body = raw
    .slice(h[0].length)
    .split("\n")
    .filter(
      (line) =>
        !/^Status:|^\*\*Candidate source leads:|^\*\*Template connections:|^\*\*Source leads:/i.test(
          line.trim(),
        ),
    )
    .join("\n")
    .replace(/\n---\s*$/, "")
    .trim();
  if (
    body.length < 100 ||
    /EDP-\d|publicationStatus|sourceSHA256|Draft version:|upstreamProviderExecutionReceiptsRecorded/.test(
      body,
    )
  )
    throw Error("NAMED_CUSTOMER_BODY_BOUNDARY_UNVERIFIED");
  const title =
    section.category === "practical-guide"
      ? section.heading.replace(/^GUIDE-C\d{2} — /, "")
      : section.heading;
  // These source-bound article sections contain prose, not tables. Keep their
  // frozen identity externally; block IDs are local editor structure only.
  // Do not invent TPL/GUD IDs to get through the operational publication route.
  if (/^\s*\|/m.test(body)) throw Error("NAMED_CONTENT_TABLE_ADAPTER_REQUIRED");
  const blockPrefix = `draft-${sha256(section.identity).slice(0, 16)}`;
  const document = documentInput.parse({
    title,
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks: body
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((part, index) => ({
          id: `${blockPrefix}-${index + 1}`,
          type: "paragraph",
          text: part.replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, ""),
          rows: [],
        })),
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
  return { rawSection: raw, body, bodyHash: sha256(body), document, documentHash: digest(document) };
}

/** Builds a real canonical draft for one frozen identity. This function has no
 * provider, database, publication, approval or customer-data dependency. */
export async function prepareFrozenContentDraft(identity: string, pkg: FiniteAllocationPackage) {
  validatePackageScope(pkg);
  if (allocationPackageId(pkg) !== frozenContentPackageId) throw Error("FROZEN_CONTENT_PACKAGE_CHANGED");
  const root = publicationWorkspaceRoot();
  if (pkg.contentIds.includes(identity)) {
    const manifestPath = "docs/content-candidates/r1-content-intake-manifest.json";
    if (
      sha256(await readFile(resolve(root, manifestPath))) !==
      pkg.sourceFiles.find((f) => f.path === manifestPath)?.sha256
    )
      throw Error("FROZEN_CONTENT_SOURCE_CHANGED");
    if (!canonicalTemplates.has(identity) && !canonicalGuidance.has(identity))
      throw Error("CONTENT_ID_NOT_SUPPORTED");
    const intake = canonicalTemplates.has(identity)
      ? await readTemplateIntake(identity)
      : await readGuidanceIntake(identity);
    const preparationClass: ContentPreparationClass = canonicalTemplates.has(identity)
      ? supportsOperationalInferenceTemplate(identity)
        ? "operational_template"
        : identity === "TPL-40"
          ? "unimplemented_template"
          : "enhanced_template"
      : "regulatory_guidance";
    return {
      identity,
      title: intake.section.title,
      preparationClass,
      sourcePath: intake.provenance.path,
      sourceHash: intake.provenance.hash,
      bodyHash: sha256(intake.section.body),
      document: intake.document,
      documentHash: digest(intake.document),
      provenanceHash: intake.provenance.noteHash,
      currentDraftStatus: "constructed_unreviewed" as const,
      reviewRequestsCreated: 0,
      publicationEligible: false as const,
    };
  }
  const section = pkg.namedContentSections.find((s) => s.identity === identity);
  if (!section) throw Error("CONTENT_OUTSIDE_FROZEN_PACKAGE");
  const source = await readFile(resolve(root, section.sourcePath), "utf8");
  const sourcePin = pkg.sourceFiles.find((f) => f.path === section.sourcePath);
  if (!sourcePin || sha256(source) !== sourcePin.sha256) throw Error("FROZEN_CONTENT_SOURCE_CHANGED");
  const result = extractNamedContentDraft(section, source);
  const preparationClass: ContentPreparationClass =
    section.category === "practical-guide"
      ? "practical_guide"
      : section.category === "industry-landing"
        ? "industry_landing"
        : "industry_pack";
  return {
    identity,
    title: result.document.title,
    preparationClass,
    sourcePath: section.sourcePath,
    sourceHash: sourcePin.sha256,
    bodyHash: result.bodyHash,
    document: result.document,
    documentHash: result.documentHash,
    provenanceHash: section.baselineSectionSha256,
    currentDraftStatus: "constructed_unreviewed" as const,
    reviewRequestsCreated: 0,
    publicationEligible: false as const,
  };
}

/** Actual per-identity engineering inventory. Unsupported review dispatch is an
 * engineering gap, kept distinct from evidence and paid-execution prerequisites. */
export async function contentPreparationReadiness(now = new Date()) {
  const pkg = await readFrozenContentPackage();
  const outcomes = [];
  for (const identity of [...pkg.contentIds, ...pkg.namedContentSections.map((s) => s.identity)]) {
    try {
      const prepared = await prepareFrozenContentDraft(identity, pkg),
        supported = prepared.preparationClass === "operational_template";
      const engineeringGaps = supported
        ? []
        : prepared.preparationClass === "unimplemented_template"
          ? [
              "Candidate-specific safe operational classification and numeric validators",
              "Runtime preparation and retained-evidence review binding",
            ]
          : prepared.preparationClass === "enhanced_template"
            ? [
                "Exact retained source/claim and enhanced-risk request adapter",
                "Candidate-specific enhanced and arithmetic fixtures",
              ]
            : prepared.preparationClass === "regulatory_guidance"
              ? [
                  "Canonical claim-to-retained-source publication bundle adapter",
                  "Candidate-specific rule and enhanced-risk fixtures",
                ]
              : [
                  "Named identity publication/review binding adapter",
                  "Candidate-specific scope, risk and numeric validators",
                ];
      const evidencePrerequisites = supported
        ? [
            "Fresh actual provider-permission snapshot",
            "Saved native candidate and matching private export artifacts",
            "Two separate measured review receipts for the exact current candidate",
            "Current policy and publisher gate recheck",
          ]
        : [
            "Exact authoritative passages for any regulatory claim; leads alone do not qualify",
            "Applicable provenance and rights artifacts",
            "Actual DOCX/PDF inspection of the final candidate",
            "Separate measured factual/challenge and required enhanced evidence",
            "Current policy and publisher gate recheck",
          ];
      outcomes.push({
        identity,
        title: prepared.title,
        preparationClass: prepared.preparationClass,
        sourcePath: prepared.sourcePath,
        sourceHash: prepared.sourceHash,
        bodyHash: prepared.bodyHash,
        canonicalDocumentHash: prepared.documentHash,
        provenanceHash: prepared.provenanceHash,
        canonicalDraft: "constructed_unreviewed",
        runtimeReviewPreparer: supported ? "operational-template-pair-v1" : null,
        preparationStatus: supported
          ? "runtime_preparer_implemented_evidence_required"
          : "review_preparer_engineering_incomplete",
        engineeringGaps,
        evidencePrerequisites,
        nativeReadiness: "not_queried",
        publicationEligible: false,
      });
    } catch (error) {
      outcomes.push({
        identity,
        canonicalDraft: "failed",
        preparationStatus: "intake_engineering_or_integrity_failure",
        errorCode: error instanceof Error ? error.message : "CONTENT_PREPARATION_FAILED",
        nativeReadiness: "not_queried",
        publicationEligible: false,
      });
    }
  }
  return {
    version: 1,
    generatedAt: now.toISOString(),
    packageId: frozenContentPackageId,
    purpose:
      "Engineering preparation evidence; not native readiness, content review, approval or launch acceptance",
    providerCalls: 0,
    approvalRowsWritten: 0,
    publicationActions: 0,
    corporaChanged: false,
    totals: {
      frozenUnits: outcomes.length,
      canonicalDrafts: outcomes.filter((x) => x.canonicalDraft === "constructed_unreviewed").length,
      implementedReviewPreparers: outcomes.filter(
        (x) => x.preparationStatus === "runtime_preparer_implemented_evidence_required",
      ).length,
      incompleteReviewPreparers: outcomes.filter(
        (x) => x.preparationStatus === "review_preparer_engineering_incomplete",
      ).length,
      intakeFailures: outcomes.filter((x) => x.canonicalDraft === "failed").length,
    },
    outcomes,
  };
}
