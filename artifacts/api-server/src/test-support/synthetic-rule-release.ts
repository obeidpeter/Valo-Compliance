import {
  candidateDigest,
  canonical,
  digest,
  disclosure,
  mandatoryMechanicalChecks,
  ruleSchema,
  sha256,
  type PublicationBundle,
  type ReleasedRule,
} from "@workspace/valo-core";

/**
 * Tests only. A synthetic rule version and the publication bundle the rule registry would admit for
 * it, citing one official source lead's URL. The attestations in it are synthetic: no model ran, no
 * reviewer read it, and it is published only into a disposable test database.
 */
export function syntheticRuleRelease(input: {
  ruleId: string;
  version: number;
  condition: NonNullable<ReleasedRule["condition"]>;
  source: { url: string; text: string; quote: string };
  now: Date;
}) {
  const at = (offsetHours: number) => new Date(+input.now + offsetHours * 3600000).toISOString();
  const host = new URL(input.source.url).hostname;
  const source = {
    id: "synthetic-source",
    url: input.source.url,
    title: "Synthetic passage of an official source",
    issuingBody: "Synthetic test authority",
    text: input.source.text,
    hash: sha256(input.source.text),
    jurisdiction: "NG",
    retrievedAt: at(-1),
    freshUntil: at(24),
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    status: "approved" as const,
    operativeTextConfirmed: true,
    amendmentsResolved: true,
  };
  const requirementVersionId = `synthetic-requirement-${input.ruleId}`;
  const rule = ruleSchema.parse({
    id: input.ruleId,
    version: input.version,
    requirementVersionId,
    title: "Synthetic released rule; not Nigerian guidance",
    jurisdiction: { level: "federal" },
    validFrom: "2026-01-01",
    validTo: null,
    sourceCheckedAt: at(-1),
    reviewBy: at(24 * 30),
    status: "published",
    provenance: "editorial_release",
    manifestHash: "0".repeat(64),
    sources: [
      {
        id: source.id,
        url: source.url,
        title: source.title,
        locator: "synthetic passage",
        quote: input.source.quote,
        snapshotHash: source.hash,
      },
    ],
    condition: input.condition,
    reason: "Synthetic reason why this may matter.",
    nextStep: "Synthetic next step.",
    relatedTemplateIds: [],
  });
  const { manifestHash: _, ...reviewedRule } = rule;
  const policyContent = {
    version: "synthetic-rule-release-policy",
    ownerApproved: true,
    allowedClasses: ["sourced_guidance"],
    jurisdictions: ["NG"],
    risks: ["general"],
    officialHosts: [host],
    blockedActivities: ["bespoke legal opinions", "certification"],
  };
  const candidate = {
    id: requirementVersionId,
    version: input.version,
    body: canonical(reviewedRule),
    hash: "",
    contentClass: "sourced_guidance" as const,
    jurisdiction: "NG",
    risk: "general" as const,
    scope: "Synthetic release-path testing only",
    limitations: "Not content for publication",
    assumptions: [],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: at(-1),
    disclosure,
    legalScopeStatus: "verified" as const,
    claims: [
      {
        text: "Synthetic claim",
        kind: "source_statement" as const,
        sourceId: source.id,
        quote: input.source.quote,
        locator: "synthetic passage",
        numbers: [],
      },
    ],
  };
  candidate.hash = candidateDigest(candidate as PublicationBundle["candidate"]);
  const evidenceHash = digest([source]);
  const run = (runId: string) => ({
    runId,
    model: "synthetic-test-not-an-actual-provider",
    promptVersion: "fixture-only",
    candidateHash: candidate.hash,
    evidenceHash,
  });
  const bundle = {
    candidate,
    sources: [source],
    policy: { ...policyContent, hash: digest(policyContent) },
    rights: {
      status: "cleared" as const,
      evidence: "Synthetic rights fixture",
      evidenceHash: sha256("fixture"),
      commercialUse: true,
    },
    draftRun: run("draft"),
    reviews: (["factual", "challenge"] as const).map((role) => ({
      ...run(role),
      role,
      verdict: "pass" as const,
      findings: [],
      receivedOtherVerdict: false,
    })),
    enhancedChecks: [],
    mechanicalChecks: mandatoryMechanicalChecks.map((name) => ({
      name,
      candidateHash: candidate.hash,
      result: "pass" as const,
      evidenceHash: sha256("synthetic-check"),
    })),
    exports: (["docx", "pdf"] as const).map((format) => ({
      format,
      candidateHash: candidate.hash,
      fileHash: sha256("synthetic-not-a-rendered-file"),
      rendered: true,
      disclosureIncluded: true,
      scopeIncluded: true,
      limitationsIncluded: true,
      sourceDateIncluded: true,
    })),
    manifest: {} as PublicationBundle["manifest"],
  };
  bundle.manifest = {
    candidateHash: candidate.hash,
    evidenceHash,
    rightsHash: digest(bundle.rights),
    policyHash: bundle.policy.hash,
    reviewHash: digest({ draft: bundle.draftRun, reviews: bundle.reviews }),
    checksHash: digest({ mechanical: bundle.mechanicalChecks, enhanced: bundle.enhancedChecks }),
    exportsHash: digest(bundle.exports),
    status: "eligible",
  };
  return { rule: { ...rule, manifestHash: digest(bundle.manifest) }, bundle };
}
