import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateDigest,
  digest,
  disclosure,
  evaluatePublication,
  mandatoryEnhancedChecks,
  mandatoryMechanicalChecks,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";

// Synthetic attestations ONLY: these fixtures cannot be used by a live publisher.
// This is an early validator unit suite, NOT the 60-case source-grounded editorial suite.
const now = new Date("2026-11-13T12:00:00Z");
function fixture(): PublicationBundle {
  const body = "Synthetic general preparation note. No legal conclusions.";
  const candidateHash = sha256(body);
  const sources: PublicationBundle["sources"] = [
    {
      id: "synthetic-source",
      url: "https://official.example.test/instrument",
      title: "Synthetic instrument",
      issuingBody: "Synthetic test authority",
      text: "Synthetic provision: record the supplied date.",
      hash: sha256("Synthetic provision: record the supplied date."),
      jurisdiction: "NG",
      retrievedAt: "2026-11-12T00:00:00Z",
      freshUntil: "2026-11-14T00:00:00Z",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
      status: "approved",
      operativeTextConfirmed: true,
      amendmentsResolved: true,
    },
  ];
  const evidenceHash = digest(sources);
  const policyContent = {
    version: "synthetic-policy",
    ownerApproved: true,
    allowedClasses: ["general_template", "sourced_guidance"],
    jurisdictions: ["NG"],
    risks: ["general", "contracts"],
    officialHosts: ["official.example.test"],
    blockedActivities: ["bespoke legal opinions", "certification"],
  };
  const run = (runId: string) => ({
    runId,
    model: "synthetic-test-not-an-actual-provider",
    promptVersion: "fixture-only",
    candidateHash,
    evidenceHash,
  });
  const b: PublicationBundle = {
    candidate: {
      id: "synthetic-candidate",
      version: 1,
      body,
      hash: candidateHash,
      contentClass: "general_template",
      jurisdiction: "NG",
      risk: "general",
      scope: "Synthetic validator testing only",
      limitations: "Not content for publication",
      assumptions: [],
      unresolvedMaterialIssues: [],
      missingEvidence: [],
      sourceCheckDate: "2026-11-12T00:00:00Z",
      disclosure,
      legalScopeStatus: "verified",
      claims: [
        {
          text: "Record supplied date",
          kind: "source_statement",
          sourceId: "synthetic-source",
          quote: "record the supplied date",
          locator: "synthetic provision",
          numbers: [],
        },
      ],
    },
    sources,
    policy: { ...policyContent, hash: digest(policyContent) },
    rights: {
      status: "cleared",
      evidence: "Synthetic rights fixture",
      evidenceHash: sha256("fixture"),
      commercialUse: true,
    },
    draftRun: run("draft"),
    reviews: (["factual", "challenge"] as const).map((role) => ({
      ...run(role),
      role,
      verdict: "pass",
      findings: [],
      receivedOtherVerdict: false,
    })),
    enhancedChecks: [],
    mechanicalChecks: mandatoryMechanicalChecks.map((name) => ({
      name,
      candidateHash,
      result: "pass",
      evidenceHash: sha256("synthetic-check"),
    })),
    exports: (["docx", "pdf"] as const).map((format) => ({
      format,
      candidateHash,
      fileHash: sha256("synthetic-not-a-rendered-file"),
      rendered: true,
      disclosureIncluded: true,
      scopeIncluded: true,
      limitationsIncluded: true,
      sourceDateIncluded: true,
    })),
    manifest: {
      candidateHash,
      evidenceHash,
      rightsHash: "",
      policyHash: "",
      reviewHash: "",
      checksHash: "",
      exportsHash: "",
      status: "eligible",
    },
  };
  rebind(b);
  return b;
}
function rebind(b: PublicationBundle) {
  b.candidate.hash = candidateDigest(b.candidate);
  for (const r of [b.draftRun, ...b.reviews]) r.candidateHash = b.candidate.hash;
  for (const check of [...b.mechanicalChecks, ...b.enhancedChecks]) check.candidateHash = b.candidate.hash;
  for (const output of b.exports) output.candidateHash = b.candidate.hash;
  b.manifest = {
    candidateHash: b.candidate.hash,
    evidenceHash: digest(b.sources),
    rightsHash: digest(b.rights),
    policyHash: b.policy.hash,
    reviewHash: digest({ draft: b.draftRun, reviews: b.reviews }),
    checksHash: digest({ mechanical: b.mechanicalChecks, enhanced: b.enhancedChecks }),
    exportsHash: digest(b.exports),
    status: "eligible",
  };
}
function operationalFixture() {
  const b = fixture();
  b.candidate.id = "TPL-07";
  b.candidate.claims = [];
  b.sources = [];
  b.candidate.evidenceMode = "original_operational";
  b.candidate.legalScopeStatus = "not_applicable";
  b.candidate.reviewBy = "2026-12-13T00:00:00Z";
  b.policy.originalOperationalIds = ["TPL-07"];
  b.policy.authorityRefs = [
    {
      path: "synthetic-owner-policy.test",
      hash: sha256("unit authority"),
      quote: "Synthetic scope; not actual owner approval",
    },
  ];
  b.policy.developmentOnly = true;
  const { hash: ignored, ...policy } = b.policy;
  b.policy.hash = digest(policy);
  for (const r of [b.draftRun, ...b.reviews]) r.evidenceHash = digest([]);
  rebind(b);
  return b;
}
test("original operational eligibility fixture requires no decorative regulatory citation", () => {
  assert.equal(evaluatePublication(operationalFixture(), now).decision, "eligible");
});
for (const [name, mutate, reason] of [
  [
    "unknown legal scope",
    (b: PublicationBundle) => {
      b.candidate.legalScopeStatus = "unverified";
    },
    "operational_scope_not_cleared",
  ],
  [
    "unset legal scope",
    (b: PublicationBundle) => {
      delete b.candidate.legalScopeStatus;
    },
    "operational_scope_not_cleared",
  ],
  [
    "stale review",
    (b: PublicationBundle) => {
      b.candidate.reviewBy = "2026-11-12T00:00:00Z";
    },
    "operational_review_expired_or_missing",
  ],
  [
    "missing review date",
    (b: PublicationBundle) => {
      delete b.candidate.reviewBy;
    },
    "operational_review_expired_or_missing",
  ],
  [
    "missing owner authority",
    (b: PublicationBundle) => {
      b.policy.authorityRefs = [];
    },
    "operational_authority_missing",
  ],
  [
    "unlisted form",
    (b: PublicationBundle) => {
      b.candidate.id = "TPL-29";
    },
    "operational_scope_not_cleared",
  ],
  [
    "tax classification",
    (b: PublicationBundle) => {
      b.candidate.risk = "tax";
    },
    "operational_scope_not_cleared",
  ],
  [
    "missing rights",
    (b: PublicationBundle) => {
      b.rights.status = "unknown";
    },
    "rights_not_cleared",
  ],
  [
    "missing PDF",
    (b: PublicationBundle) => {
      b.exports = b.exports.filter((e) => e.format !== "pdf");
    },
    "export_not_passed:pdf",
  ],
  [
    "held challenge",
    (b: PublicationBundle) => {
      b.reviews.find((r) => r.role === "challenge")!.verdict = "hold";
    },
    "review_not_clear:challenge",
  ],
  [
    "altered body",
    (b: PublicationBundle) => {
      b.candidate.body += " Altered";
    },
    "candidate_hash_mismatch",
  ],
] as const)
  test(`original operational policy rejects ${name}`, () => {
    const b = operationalFixture();
    mutate(b);
    const result = evaluatePublication(b, now);
    assert.equal(result.decision, "hold");
    assert.ok(result.reasons.includes(reason));
  });
test("regulatory content cannot use the operational no-citation path", () => {
  const b = fixture();
  b.sources = [];
  delete b.candidate.legalScopeStatus;
  const result = evaluatePublication(b, now);
  assert.ok(result.reasons.includes("regulatory_sources_required"));
  assert.ok(result.reasons.includes("legal_scope_unverified"));
});
test("canonical hashing is property-order independent", () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
});
test("complete synthetic attestations establish eligibility, never publication", () => {
  assert.deepEqual(evaluatePublication(fixture(), now), { decision: "eligible", reasons: [] });
});
const cases: [string, (b: PublicationBundle) => void, string][] = [
  [
    "changed body",
    (b) => {
      b.candidate.body += " edit";
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed applicability scope",
    (b) => {
      b.candidate.scope = "Different audience";
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed assumptions",
    (b) => {
      b.candidate.assumptions.push("New use assumption");
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed claim wording",
    (b) => {
      b.candidate.claims[0].text = "New legal conclusion";
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed content version",
    (b) => {
      b.candidate.version += 1;
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed source-check date",
    (b) => {
      b.candidate.sourceCheckDate = "2026-11-11T00:00:00Z";
    },
    "candidate_hash_mismatch",
  ],
  [
    "changed source text",
    (b) => {
      b.sources[0].text += " tampering";
    },
    "source_hash_mismatch",
  ],
  [
    "policy not approved",
    (b) => {
      b.policy.ownerApproved = false;
    },
    "policy_not_owner_approved",
  ],
  [
    "policy changed after binding",
    (b) => {
      b.policy.risks.push("tax");
    },
    "policy_hash_mismatch",
  ],
  [
    "jurisdiction outside policy",
    (b) => {
      b.candidate.jurisdiction = "GH";
    },
    "jurisdiction_outside_policy",
  ],
  [
    "risk outside policy",
    (b) => {
      b.candidate.risk = "employment";
    },
    "risk_outside_policy",
  ],
  [
    "unresolved contract clause",
    (b) => {
      b.candidate.unresolvedMaterialIssues = ["Termination clause unresolved"];
    },
    "material_uncertainty",
  ],
  [
    "missing evidence",
    (b) => {
      b.candidate.missingEvidence = ["Operative text unavailable"];
    },
    "material_uncertainty",
  ],
  [
    "future source check",
    (b) => {
      b.candidate.sourceCheckDate = "2026-11-15T00:00:00Z";
    },
    "source_check_in_future",
  ],
  [
    "unknown rights",
    (b) => {
      b.rights.status = "unknown";
    },
    "rights_not_cleared",
  ],
  [
    "no commercial-use rights",
    (b) => {
      b.rights.commercialUse = false;
    },
    "rights_not_cleared",
  ],
  [
    "withdrawn manifest",
    (b) => {
      b.manifest.status = "withdrawn";
    },
    "manifest_not_eligible",
  ],
  [
    "source hostname suffix attack",
    (b) => {
      b.sources[0].url = "https://official.example.test.attacker.test";
    },
    "source_not_allowlisted",
  ],
  [
    "source credentials attack",
    (b) => {
      b.sources[0].url = "https://attacker@official.example.test";
    },
    "source_not_allowlisted",
  ],
  [
    "source HTTP",
    (b) => {
      b.sources[0].url = "http://official.example.test";
    },
    "source_not_allowlisted",
  ],
  [
    "held operative text",
    (b) => {
      b.sources[0].operativeTextConfirmed = false;
    },
    "source_unresolved",
  ],
  [
    "unresolved amendments",
    (b) => {
      b.sources[0].amendmentsResolved = false;
    },
    "source_unresolved",
  ],
  [
    "expired evidence",
    (b) => {
      b.sources[0].freshUntil = "2026-11-13T12:00:00Z";
    },
    "source_not_current",
  ],
  [
    "historical concession",
    (b) => {
      b.sources[0].effectiveTo = "2025-01-01T00:00:00Z";
    },
    "source_not_current",
  ],
  [
    "wrong source jurisdiction",
    (b) => {
      b.sources[0].jurisdiction = "GH";
    },
    "source_jurisdiction_mismatch",
  ],
  [
    "fabricated quote",
    (b) => {
      b.candidate.claims[0].quote = "This sentence is not in the source.";
    },
    "unsupported_claim",
  ],
  [
    "invented numerical claim",
    (b) => {
      b.candidate.claims[0].numbers = ["7.5%"];
    },
    "unsupported_number",
  ],
  [
    "review reuses draft run",
    (b) => {
      b.reviews[0].runId = "draft";
    },
    "runs_not_separate",
  ],
  [
    "missing challenge review",
    (b) => {
      b.reviews.pop();
    },
    "review_required:challenge",
  ],
  [
    "review disagreement",
    (b) => {
      b.reviews[1].verdict = "hold";
    },
    "review_not_clear:challenge",
  ],
  [
    "review saw other verdict",
    (b) => {
      b.reviews[1].receivedOtherVerdict = true;
    },
    "review_not_blind:challenge",
  ],
  [
    "stale review",
    (b) => {
      b.reviews[0].candidateHash = sha256("other-version");
    },
    "run_binding_mismatch",
  ],
  [
    "failed deterministic arithmetic",
    (b) => {
      b.mechanicalChecks.find((c) => c.name === "arithmetic")!.result = "fail";
    },
    "check_not_passed:arithmetic",
  ],
  [
    "missing deterministic check",
    (b) => {
      b.mechanicalChecks.pop();
    },
    "check_not_passed:rule_fixtures",
  ],
  [
    "missing PDF",
    (b) => {
      b.exports = b.exports.filter((e) => e.format !== "pdf");
    },
    "export_not_passed:pdf",
  ],
  [
    "PDF missing disclosure",
    (b) => {
      b.exports[1].disclosureIncluded = false;
    },
    "export_not_passed:pdf",
  ],
  [
    "PDF bound to old version",
    (b) => {
      b.exports[1].candidateHash = sha256("old");
    },
    "export_not_passed:pdf",
  ],
  [
    "forged rights binding",
    (b) => {
      b.manifest.rightsHash = sha256("forged");
    },
    "manifest_mismatch:rightsHash",
  ],
];
for (const [name, mutate, reason] of cases) {
  test(`holds ${name}`, () => {
    const b = fixture();
    mutate(b);
    const result = evaluatePublication(b, now);
    assert.equal(result.decision, "hold");
    assert.ok(
      result.reasons.some((r) => r.startsWith(reason)),
      JSON.stringify(result),
    );
  });
}
test("enhanced content requires every controlling-text check", () => {
  const b = fixture();
  b.candidate.risk = "contracts";
  b.candidate.assumptions = ["Synthetic company scenario"];
  rebind(b);
  assert.equal(evaluatePublication(b, now).decision, "hold");
  b.enhancedChecks = mandatoryEnhancedChecks.map((name) => ({
    name,
    candidateHash: b.candidate.hash,
    evidenceHash: sha256("synthetic"),
    result: "pass",
  }));
  rebind(b);
  assert.equal(evaluatePublication(b, now).decision, "eligible");
});
test("empty or untyped input holds instead of throwing", () => {
  for (const value of [null, [], {}, "pass", { manifest: { status: "eligible" } }]) {
    assert.equal(evaluatePublication(value, now).decision, "hold");
  }
});
test("unknown schema fields cannot smuggle an override", () => {
  assert.equal(evaluatePublication({ ...fixture(), ownerOverride: true }, now).decision, "hold");
});
test("invalid server clock holds", () => {
  assert.equal(evaluatePublication(fixture(), new Date("invalid")).decision, "hold");
});

// CMP-001: "missing authoritative evidence, scope or review manifest blocks publication of the
// affected claim; a human reviewer is not a required field."
test("missing authoritative evidence, scope or review holds an item, and no human reviewer is required", () => {
  const complete = fixture();
  assert.deepEqual(evaluatePublication(complete, now), { decision: "eligible", reasons: [] });
  // The complete record names no human reviewer, approver or professional sign-off.
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      for (const [key, inner] of Object.entries(value)) {
        keys.push(key);
        walk(inner);
      }
  };
  walk(complete);
  assert.ok(keys.length > 50, "the record's fields were read");
  assert.deepEqual(
    keys.filter((key) => /human|lawyer|specialist|approver|approvedBy|signOff|professional/i.test(key)),
    [],
  );
  const holds = (change: (b: PublicationBundle) => void, reason: string) => {
    const b = fixture();
    change(b);
    rebind(b);
    const result = evaluatePublication(b, now);
    assert.equal(result.decision, "hold", reason);
    assert.ok(result.reasons.includes(reason), `${reason}: ${result.reasons.join(", ")}`);
  };
  holds(
    (b) => (b.candidate.missingEvidence = ["Synthetic operative text not retrieved"]),
    "material_uncertainty",
  );
  holds((b) => (b.sources = []), "regulatory_sources_required");
  holds((b) => (b.candidate.legalScopeStatus = "unverified"), "legal_scope_unverified");
  holds((b) => delete b.candidate.legalScopeStatus, "legal_scope_unverified");
  holds((b) => (b.reviews = b.reviews.filter((r) => r.role !== "challenge")), "review_required:challenge");
  const unreviewed = fixture();
  unreviewed.manifest.status = "review";
  assert.deepEqual(evaluatePublication(unreviewed, now).reasons, ["manifest_not_eligible"]);
});

// CMP-008: "separate drafting and review runs plus deterministic gates control automated
// publication. No Nigerian specialist or second human approval is required."
test("publication needs a separate drafting run and two separate, blind and clear review runs", () => {
  assert.equal(evaluatePublication(fixture(), now).decision, "eligible");
  const holds = (change: (b: PublicationBundle) => void, reason: string) => {
    const b = fixture();
    change(b);
    rebind(b);
    const result = evaluatePublication(b, now);
    assert.equal(result.decision, "hold", reason);
    assert.ok(result.reasons.includes(reason), `${reason}: ${result.reasons.join(", ")}`);
  };
  holds((b) => (b.reviews[0]!.runId = b.draftRun.runId), "runs_not_separate");
  holds((b) => (b.reviews[1]!.runId = b.reviews[0]!.runId), "runs_not_separate");
  holds((b) => (b.reviews[0]!.receivedOtherVerdict = true), "review_not_blind:factual");
  holds((b) => (b.reviews[1]!.verdict = "hold"), "review_not_clear:challenge");
  holds((b) => (b.reviews[0]!.findings = ["Synthetic unresolved finding"]), "review_not_clear:factual");
  holds((b) => (b.reviews = [b.reviews[0]!, { ...b.reviews[0]! }]), "review_required:challenge");
});
