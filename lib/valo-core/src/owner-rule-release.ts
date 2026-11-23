import { z } from "zod";
import { checkerFactsSchema, ruleSchema, type ReleasedRule } from "./checker";
import { canonical, digest, mandatoryEnhancedChecks, publicationSchema, sha256 } from "./publication";

/**
 * A requirements-checker rule released on the development owner's sign-off (decision 0020), in place
 * of the two AI reviews the reviewed route needs. The bundle carries the rule's candidate, its sources
 * and their passages, its rights record, the guidance policy it is released under and its scenarios,
 * bound by a manifest. It has no AI run or review records, and nothing in it says a review happened:
 * the owner's sign-off is recorded in the database, against this bundle's manifest.
 */

/** EDP-005's enhanced checks, which the owner confirms one by one for any risk but `general`. */
export const ownerConfirmedChecks = mandatoryEnhancedChecks;
export type OwnerConfirmedCheck = (typeof ownerConfirmedChecks)[number];

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const shape = publicationSchema.shape;

/** What an owner-signed rule says about how it was made. The reviewed route's disclosure says the
 * content was AI drafted and reviewed, which is not true of these. */
export const ownerRuleDisclosure =
  "Released on the Valo development owner's sign-off after a check of its official sources; not reviewed by a Nigerian legal, tax or sector specialist" as const;
const ownerRuleCandidateSchema = shape.candidate
  .extend({ disclosure: z.literal(ownerRuleDisclosure) })
  .strict();
type OwnerRuleCandidate = z.infer<typeof ownerRuleCandidateSchema>;

/** The digest an owner-signed candidate's hash must be: of all of it but its hash, as for any
 * candidate (`candidateDigest`). */
export function ownerRuleCandidateDigest(candidate: Omit<OwnerRuleCandidate, "hash"> | OwnerRuleCandidate) {
  const { hash: _ignored, ...content } = candidate as OwnerRuleCandidate;
  return digest(content);
}

export const ownerRuleScenarioSchema = z
  .object({
    id: z.string().min(1).max(100),
    facts: checkerFactsSchema,
    asOfDate: z.string().date(),
    /** The label the rule must give for these answers, or null when it must not appear at all. */
    expectedLabel: z.string().min(1).nullable(),
    critical: z.boolean(),
  })
  .strict();

export const ownerRuleBundleSchema = z
  .object({
    kind: z.literal("owner_signoff"),
    candidate: ownerRuleCandidateSchema,
    sources: shape.sources,
    rights: shape.rights,
    policy: shape.policy,
    scenarios: z.array(ownerRuleScenarioSchema).min(1),
    manifest: z
      .object({
        candidateHash: hash,
        evidenceHash: hash,
        rightsHash: hash,
        policyHash: hash,
        scenariosHash: hash,
        status: z.literal("owner_signoff"),
      })
      .strict(),
  })
  .strict();
export type OwnerRuleBundle = z.infer<typeof ownerRuleBundleSchema>;

/** The manifest that binds a bundle's parts, worked out from them. */
export function ownerRuleManifest(bundle: Omit<OwnerRuleBundle, "manifest">): OwnerRuleBundle["manifest"] {
  const { hash: policyHash } = bundle.policy;
  return {
    candidateHash: bundle.candidate.hash,
    evidenceHash: digest(bundle.sources),
    rightsHash: digest(bundle.rights),
    policyHash,
    scenariosHash: digest(bundle.scenarios),
    status: "owner_signoff",
  };
}

/**
 * Whether an owner-signed bundle's evidence would let the owner sign it, apart from what needs the
 * database (the source check, the sign-off itself and the sources' current state). The evidence checks
 * are the reviewed route's (`evaluatePublication`), unchanged, and a test runs the same altered
 * evidence through both. A rule is always sourced guidance and never original operational content.
 */
export function evaluateOwnerRuleBundle(input: unknown, now = new Date()) {
  const parsed = ownerRuleBundleSchema.safeParse(input);
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
  const timestamp = now.getTime();
  fail(!Number.isFinite(timestamp), "invalid_clock");
  fail(c.hash !== ownerRuleCandidateDigest(c), "candidate_hash_mismatch");
  fail(!b.policy.ownerApproved, "policy_not_owner_approved");
  const { hash: policyHash, ...policyContent } = b.policy;
  fail(policyHash !== digest(policyContent), "policy_hash_mismatch");
  fail(!b.policy.allowedClasses.includes(c.contentClass), "class_outside_policy");
  fail(!b.policy.jurisdictions.includes(c.jurisdiction), "jurisdiction_outside_policy");
  fail(!b.policy.risks.includes(c.risk), "risk_outside_policy");
  fail(c.unresolvedMaterialIssues.length > 0 || c.missingEvidence.length > 0, "material_uncertainty");
  fail(c.contentClass !== "sourced_guidance", "rule_not_sourced_guidance");
  fail(c.evidenceMode === "original_operational" || c.coverage !== undefined, "rule_not_sourced_guidance");
  fail(b.sources.length === 0, "regulatory_sources_required");
  fail(c.legalScopeStatus !== "verified", "legal_scope_unverified");
  fail(Date.parse(c.sourceCheckDate) > timestamp, "source_check_in_future");
  fail(
    /lawyer approved|professionally verified|guaranteed compliant/i.test(c.body),
    "unsupported_professional_claim",
  );
  fail(b.rights.status !== "cleared" || !b.rights.commercialUse, "rights_not_cleared");

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
  if (c.risk === "contracts") fail(c.assumptions.length === 0, "contract_assumptions_missing");
  const scenarioIds = b.scenarios.map((s) => s.id);
  fail(new Set(scenarioIds).size !== scenarioIds.length, "duplicate_scenario_id");
  fail(!b.scenarios.some((s) => s.critical), "no_critical_scenario");
  const expected = ownerRuleManifest(b);
  for (const key of ["candidateHash", "evidenceHash", "rightsHash", "policyHash", "scenariosHash"] as const)
    fail(b.manifest[key] !== expected[key], `manifest_mismatch:${key}`);
  return {
    decision: reasons.length ? ("hold" as const) : ("eligible" as const),
    reasons: [...new Set(reasons)],
  };
}

/**
 * Whether a stored rule is the one its owner-signed bundle describes: the candidate's body is the rule
 * without its manifest hash, the rule's manifest hash is the bundle manifest's digest, and each of the
 * rule's sources is a bundle source whose text holds the rule's quote, mapped by a claim at the same
 * locator.
 */
export function ownerRuleMatchesBundle(rule: ReleasedRule, bundle: OwnerRuleBundle) {
  const { manifestHash: _, ...content } = rule;
  return (
    rule.provenance === "owner_signoff" &&
    rule.status === "published" &&
    rule.requirementVersionId === bundle.candidate.id &&
    rule.version === bundle.candidate.version &&
    bundle.candidate.body === canonical(content) &&
    rule.manifestHash === digest(bundle.manifest) &&
    rule.sources.every(
      (s) =>
        bundle.sources.some(
          (bs) =>
            bs.id === s.id && bs.hash === s.snapshotHash && bs.url === s.url && bs.text.includes(s.quote),
        ) &&
        bundle.candidate.claims.some(
          (claim) => claim.sourceId === s.id && claim.locator === s.locator && claim.quote === s.quote,
        ),
    )
  );
}

/** Parses a stored rule and its owner-signed bundle, or null when either is not one. */
export function parseOwnerRuleRelease(rule: unknown, bundle: unknown) {
  const r = ruleSchema.safeParse(rule),
    b = ownerRuleBundleSchema.safeParse(bundle);
  return r.success && b.success ? { rule: r.data, bundle: b.data } : null;
}

/** The candidate and sources of a stored release's bundle, whichever route released it: a reviewed
 * publication bundle or an owner-signed rule bundle. Null when it is neither. */
export function releaseEvidence(raw: unknown) {
  const reviewed = publicationSchema.safeParse(raw);
  if (reviewed.success) return { candidate: reviewed.data.candidate, sources: reviewed.data.sources };
  const owner = ownerRuleBundleSchema.safeParse(raw);
  return owner.success ? { candidate: owner.data.candidate, sources: owner.data.sources } : null;
}
