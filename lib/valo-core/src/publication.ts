import { createHash } from "node:crypto";
import { z } from "zod";

export const disclosure =
  "AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist";
export const sha256 = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
export const invoiceQuotationGuideIds = ["GUIDE-C01", "GUIDE-C02"] as const;
export const reminderInventoryGuideIds = ["GUIDE-C03", "GUIDE-C04"] as const;
export const practicalGuideIds = [...invoiceQuotationGuideIds, ...reminderInventoryGuideIds] as const;
export function isPracticalGuideId(id: string): id is (typeof practicalGuideIds)[number] {
  return practicalGuideIds.some((value) => value === id);
}
const nonempty = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const run = z
  .object({
    runId: nonempty,
    model: nonempty,
    promptVersion: nonempty,
    candidateHash: hash,
    evidenceHash: hash,
  })
  .strict();
const test = z
  .object({
    name: nonempty,
    candidateHash: hash,
    result: z.enum(["pass", "fail", "not_run"]),
    evidenceHash: hash,
  })
  .strict();

export const publicationSchema = z
  .object({
    candidate: z
      .object({
        id: nonempty,
        version: z.number().int().positive(),
        body: nonempty,
        hash,
        contentClass: z.enum(["general_template", "sourced_guidance", "practical_guide"]),
        jurisdiction: nonempty,
        risk: z.enum([
          "general",
          "tax",
          "employment",
          "privacy",
          "governance",
          "contracts",
          "regulated_sector",
        ]),
        scope: nonempty,
        limitations: nonempty,
        assumptions: z.array(nonempty),
        unresolvedMaterialIssues: z.array(nonempty),
        missingEvidence: z.array(nonempty),
        sourceCheckDate: date,
        disclosure: z.literal(disclosure),
        evidenceMode: z.enum(["regulatory", "original_operational"]).optional(),
        legalScopeStatus: z.enum(["verified", "unverified", "not_applicable"]).optional(),
        reviewBy: date.optional(),
        coverage: z
          .object({
            kind: z.enum(["template", "guidance", "guide", "industry_pack", "location_pack"]),
            industrySlugs: z.array(nonempty).max(20),
            locationIds: z.array(nonempty).max(37),
          })
          .strict()
          .optional(),
        claims: z.array(
          z
            .object({
              text: nonempty,
              kind: z.enum(["source_statement", "interpretation", "optional_practice"]),
              sourceId: nonempty,
              quote: nonempty,
              locator: nonempty,
              numbers: z.array(nonempty),
            })
            .strict(),
        ),
      })
      .strict(),
    sources: z.array(
      z
        .object({
          id: nonempty,
          url: z.string().url(),
          title: nonempty,
          issuingBody: nonempty,
          text: nonempty,
          hash,
          jurisdiction: nonempty,
          retrievedAt: date,
          freshUntil: date,
          effectiveFrom: date,
          effectiveTo: date.nullable(),
          status: z.enum(["approved", "held", "withdrawn"]),
          operativeTextConfirmed: z.boolean(),
          amendmentsResolved: z.boolean(),
        })
        .strict(),
    ),
    rights: z
      .object({
        status: z.enum(["cleared", "unknown", "denied"]),
        evidence: nonempty,
        evidenceHash: hash,
        commercialUse: z.boolean(),
      })
      .strict(),
    policy: z
      .object({
        version: nonempty,
        hash,
        ownerApproved: z.boolean(),
        allowedClasses: z.array(nonempty),
        jurisdictions: z.array(nonempty),
        risks: z.array(nonempty),
        officialHosts: z.array(nonempty).min(1),
        blockedActivities: z.array(nonempty),
        originalOperationalIds: z.array(nonempty).optional(),
        authorityRefs: z.array(z.object({ path: nonempty, hash, quote: nonempty }).strict()).optional(),
        developmentOnly: z.boolean().optional(),
      })
      .strict(),
    draftRun: run,
    reviews: z.array(
      run
        .extend({
          role: z.enum(["factual", "challenge"]),
          verdict: z.enum(["pass", "hold"]),
          findings: z.array(nonempty),
          receivedOtherVerdict: z.boolean(),
        })
        .strict(),
    ),
    enhancedChecks: z.array(test),
    mechanicalChecks: z.array(test),
    exports: z.array(
      z
        .object({
          format: z.enum(["docx", "pdf"]),
          candidateHash: hash,
          fileHash: hash,
          rendered: z.boolean(),
          disclosureIncluded: z.boolean(),
          scopeIncluded: z.boolean(),
          limitationsIncluded: z.boolean(),
          sourceDateIncluded: z.boolean(),
        })
        .strict(),
    ),
    manifest: z
      .object({
        candidateHash: hash,
        evidenceHash: hash,
        rightsHash: hash,
        policyHash: hash,
        reviewHash: hash,
        checksHash: hash,
        exportsHash: hash,
        status: z.enum(["review", "eligible", "withdrawn"]),
      })
      .strict(),
  })
  .strict();

export type PublicationBundle = z.infer<typeof publicationSchema>;

/** The entire candidate, not just visible body text, must be bound to review evidence. */
export function candidateDigest(
  candidate: Omit<PublicationBundle["candidate"], "hash"> | PublicationBundle["candidate"],
) {
  const { hash: _ignored, ...content } = candidate as PublicationBundle["candidate"];
  return digest(content);
}

/** Fixed property-order encoding for durable manifests. Arrays retain semantic order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value: unknown): string => sha256(canonical(value));

export const mandatoryMechanicalChecks = [
  "schema",
  "source_locators",
  "dates",
  "scope",
  "numeric_extraction",
  "rights",
  "required_fields",
  "disclosures",
  "arithmetic",
  "rule_fixtures",
] as const;
export const mandatoryEnhancedChecks = [
  "controlling_text",
  "amendments",
  "effective_dates",
  "exceptions",
  "jurisdiction",
] as const;

/** Eligibility evaluator only. It never publishes or trusts a client-supplied pass to release content.
 * Future publisher MUST obtain the bundle from a trusted immutable store, recompute evidence
 * and export attestations, and check this result inside its release transaction.
 */
export function evaluatePublication(input: unknown, now = new Date()) {
  const parsed = publicationSchema.safeParse(input);
  if (!parsed.success)
    return {
      decision: "hold" as const,
      reasons: parsed.error.issues.map((issue) => `schema:${issue.path.join(".")}:${issue.message}`),
    };
  const b = parsed.data;
  const c = b.candidate;
  const reasons: string[] = [];
  const fail = (condition: boolean, reason: string) => {
    if (condition) reasons.push(reason);
  };
  if (c.coverage) {
    fail(
      (c.contentClass === "general_template") !== (c.coverage.kind === "template"),
      "coverage_class_mismatch",
    );
    fail(
      c.coverage.kind === "industry_pack" && c.coverage.industrySlugs.length !== 1,
      "industry_pack_scope_missing",
    );
    fail(
      c.coverage.kind === "location_pack" &&
        (c.jurisdiction === "NG" ||
          c.coverage.locationIds.length !== 1 ||
          c.coverage.locationIds[0] !== c.jurisdiction),
      "location_pack_scope_mismatch",
    );
  }
  const evidenceHash = digest(b.sources);
  const timestamp = now.getTime();
  fail(!Number.isFinite(timestamp), "invalid_clock");
  fail(c.hash !== candidateDigest(c), "candidate_hash_mismatch");
  fail(!b.policy.ownerApproved, "policy_not_owner_approved");
  const { hash: policyHash, ...policyContent } = b.policy;
  fail(policyHash !== digest(policyContent), "policy_hash_mismatch");
  fail(!b.policy.allowedClasses.includes(c.contentClass), "class_outside_policy");
  fail(!b.policy.jurisdictions.includes(c.jurisdiction), "jurisdiction_outside_policy");
  fail(!b.policy.risks.includes(c.risk), "risk_outside_policy");
  fail(c.unresolvedMaterialIssues.length > 0 || c.missingEvidence.length > 0, "material_uncertainty");
  const operational = c.evidenceMode === "original_operational";
  const practical = c.contentClass === "practical_guide";
  if (practical || isPracticalGuideId(c.id)) {
    fail(
      !practical ||
        !isPracticalGuideId(c.id) ||
        !operational ||
        c.coverage?.kind !== "guide" ||
        c.jurisdiction !== "NG" ||
        c.coverage.industrySlugs.length !== 0 ||
        c.coverage.locationIds.length !== 0 ||
        b.policy.developmentOnly !== true,
      "practical_guide_scope_mismatch",
    );
  }
  if (operational) {
    fail(
      (!practical && c.contentClass !== "general_template") ||
        c.risk !== "general" ||
        c.claims.length !== 0 ||
        c.legalScopeStatus !== "not_applicable" ||
        !b.policy.originalOperationalIds?.includes(c.id),
      "operational_scope_not_cleared",
    );
    fail(!b.policy.authorityRefs?.length, "operational_authority_missing");
    fail(!c.reviewBy || Date.parse(c.reviewBy) <= timestamp, "operational_review_expired_or_missing");
    fail(b.sources.length !== 0, "operational_form_must_not_borrow_regulatory_evidence");
  } else {
    fail(b.sources.length === 0, "regulatory_sources_required");
    fail(c.legalScopeStatus !== "verified", "legal_scope_unverified");
  }
  fail(Date.parse(c.sourceCheckDate) > timestamp, "source_check_in_future");
  fail(
    /lawyer approved|professionally verified|guaranteed compliant/i.test(c.body),
    "unsupported_professional_claim",
  );
  fail(b.rights.status !== "cleared" || !b.rights.commercialUse, "rights_not_cleared");
  fail(b.manifest.status !== "eligible", "manifest_not_eligible");

  const sourceIds = b.sources.map((s) => s.id);
  fail(new Set(sourceIds).size !== sourceIds.length, "duplicate_source_id");
  for (const s of b.sources) {
    const url = new URL(s.url);
    fail(
      url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        (url.port !== "" && url.port !== "443") ||
        !b.policy.officialHosts.includes(url.hostname),
      `source_not_allowlisted:${s.id}`,
    );
    fail(s.hash !== sha256(s.text), `source_hash_mismatch:${s.id}`);
    fail(
      s.status !== "approved" || !s.operativeTextConfirmed || !s.amendmentsResolved,
      `source_unresolved:${s.id}`,
    );
    fail(s.jurisdiction !== c.jurisdiction, `source_jurisdiction_mismatch:${s.id}`);
    fail(
      Date.parse(s.retrievedAt) > timestamp ||
        Date.parse(s.freshUntil) <= timestamp ||
        Date.parse(s.effectiveFrom) > timestamp ||
        (s.effectiveTo !== null && Date.parse(s.effectiveTo) <= timestamp),
      `source_not_current:${s.id}`,
    );
  }
  for (const claim of c.claims) {
    const source = b.sources.find((s) => s.id === claim.sourceId);
    fail(!source || !source.text.includes(claim.quote), `unsupported_claim:${claim.locator}`);
    fail(
      claim.numbers.some((n) => !claim.quote.includes(n)),
      `unsupported_number:${claim.locator}`,
    );
  }
  fail(c.risk !== "general" && c.claims.length === 0, "enhanced_content_has_no_claim_mapping");
  const runs = [b.draftRun, ...b.reviews];
  fail(new Set(runs.map((r) => r.runId)).size !== runs.length, "runs_not_separate");
  for (const r of runs) {
    fail(r.candidateHash !== c.hash || r.evidenceHash !== evidenceHash, "run_binding_mismatch");
  }
  for (const role of ["factual", "challenge"]) {
    const reviews = b.reviews.filter((r) => r.role === role);
    fail(reviews.length !== 1, `review_required:${role}`);
    for (const r of reviews) {
      fail(r.verdict !== "pass" || r.findings.length > 0, `review_not_clear:${role}`);
      fail(r.receivedOtherVerdict, `review_not_blind:${role}`);
    }
  }
  const checks = (names: readonly string[], records: PublicationBundle["mechanicalChecks"]) => {
    for (const name of names) {
      const matches = records.filter((check) => check.name === name);
      fail(
        matches.length !== 1 ||
          matches.some((check) => check.result !== "pass" || check.candidateHash !== c.hash),
        `check_not_passed:${name}`,
      );
    }
    fail(
      records.some((check) => check.result !== "pass" || check.candidateHash !== c.hash),
      "check_failed_or_stale",
    );
  };
  checks(mandatoryMechanicalChecks, b.mechanicalChecks);
  if (c.risk !== "general") checks(mandatoryEnhancedChecks, b.enhancedChecks);
  if (c.risk === "contracts") fail(c.assumptions.length === 0, "contract_assumptions_missing");
  for (const format of ["docx", "pdf"]) {
    const exports = b.exports.filter((e) => e.format === format);
    fail(
      exports.length !== 1 ||
        exports.some(
          (e) =>
            e.candidateHash !== c.hash ||
            !e.rendered ||
            !e.disclosureIncluded ||
            !e.scopeIncluded ||
            !e.limitationsIncluded ||
            !e.sourceDateIncluded,
        ),
      `export_not_passed:${format}`,
    );
  }
  const manifestBindings = {
    candidateHash: c.hash,
    evidenceHash,
    rightsHash: digest(b.rights),
    policyHash,
    reviewHash: digest({ draft: b.draftRun, reviews: b.reviews }),
    checksHash: digest({ mechanical: b.mechanicalChecks, enhanced: b.enhancedChecks }),
    exportsHash: digest(b.exports),
  };
  for (const [key, value] of Object.entries(manifestBindings)) {
    fail(b.manifest[key as keyof typeof manifestBindings] !== value, `manifest_mismatch:${key}`);
  }
  return {
    decision: reasons.length ? ("hold" as const) : ("eligible" as const),
    reasons: [...new Set(reasons)],
  };
}
