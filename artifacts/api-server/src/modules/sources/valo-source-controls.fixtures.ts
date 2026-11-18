import { digest, disclosure, publicationSchema, type PublicationBundle } from "@workspace/valo-core";
/** Deliberately NOT an eligible publication: rights unknown, unapproved policy,
 * no review/export receipts and a review-only manifest. Tests only the extra
 * current-source boundary; it cannot grant release on its own. */
export function heldSourceBundle(now: Date, regulatory = true): PublicationBundle {
  const h = digest("controlled bytes, not Nigerian evidence"),
    date = now.toISOString();
  return publicationSchema.parse({
    candidate: {
      id: "controlled-held-candidate",
      version: 1,
      body: "Controlled boundary fixture only",
      hash: h,
      contentClass: regulatory ? "sourced_guidance" : "general_template",
      jurisdiction: "NG",
      risk: regulatory ? "privacy" : "general",
      scope: "Synthetic test",
      limitations: "No publication evidence",
      assumptions: [],
      unresolvedMaterialIssues: ["Unreviewed fixture"],
      missingEvidence: ["Provider reviews"],
      sourceCheckDate: date,
      disclosure,
      evidenceMode: regulatory ? "regulatory" : "original_operational",
      legalScopeStatus: "unverified",
      reviewBy: new Date(+now + 90 * 86400000).toISOString(),
      claims: [],
    },
    sources: regulatory
      ? [
          {
            id: "controlled",
            url: "https://example.test/controlled",
            title: "Controlled fixture",
            issuingBody: "Test",
            text: "controlled source text",
            hash: h,
            jurisdiction: "NG",
            retrievedAt: date,
            freshUntil: new Date(+now + 86400000).toISOString(),
            effectiveFrom: date,
            effectiveTo: null,
            status: "held",
            operativeTextConfirmed: false,
            amendmentsResolved: false,
          },
        ]
      : [],
    rights: { status: "unknown", evidence: "not cleared", evidenceHash: h, commercialUse: false },
    policy: {
      version: "test",
      hash: h,
      ownerApproved: false,
      allowedClasses: [],
      jurisdictions: [],
      risks: [],
      officialHosts: ["example.test"],
      blockedActivities: [],
    },
    draftRun: {
      runId: "not-a-provider-receipt",
      model: "controlled",
      promptVersion: "test",
      candidateHash: h,
      evidenceHash: h,
    },
    reviews: [],
    enhancedChecks: [],
    mechanicalChecks: [],
    exports: [],
    manifest: {
      candidateHash: h,
      evidenceHash: h,
      rightsHash: h,
      policyHash: h,
      reviewHash: h,
      checksHash: h,
      exportsHash: h,
      status: "review",
    },
  });
}
