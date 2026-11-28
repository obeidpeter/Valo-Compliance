import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePublication, sha256, type PublicationBundle } from "@workspace/valo-core";
import { heldSourceBundle } from "../sources/valo-source-controls.fixtures";
import { capturedPassages, capturedTexts } from "./guidance-captured-texts";
import type { GuidePassage, GuidePassages } from "./guidance-passages";
import { guidanceOfficialHosts, guidancePolicy } from "./guidance-policy";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import { privacyTemplateClaimMaps } from "./template-claims-privacy";
import {
  buildLawTemplateCandidate,
  lawTemplatePassageIds,
  TEMPLATE_LAW_LIMITATIONS,
  TEMPLATE_LAW_PART,
  TEMPLATE_LAW_SCOPE,
} from "./template-law-candidate";
import {
  releasePolicyKind,
  TEMPLATE_LAW_POLICY_PATH,
  templateLawPolicy,
  templateLawPolicyApprovedHash,
  templateLawPolicySentences,
} from "./template-law-policy";

/**
 * The source-backed policy for templates that state the law (docs/architecture/reviewed-route.md,
 * part 4). It is a proposal: the owner has approved no text of it, so every such template is held.
 */
const policyFile = readFileSync(resolve(publicationWorkspaceRoot(), TEMPLATE_LAW_POLICY_PATH), "utf8");
/** The policy file as a test supposes it, with a restriction file beside it or none. */
const supposed =
  (text: string, restrictions?: unknown) =>
  async (path: string): Promise<string> => {
    if (path === TEMPLATE_LAW_POLICY_PATH) return text;
    if (restrictions !== undefined) return JSON.stringify(restrictions);
    throw Object.assign(Error("no file"), { code: "ENOENT" });
  };

test("no text of the policy for templates that state the law is approved, so every such template is held", async () => {
  assert.equal(templateLawPolicyApprovedHash(), null);
  assert.match(
    policyFile,
    /Status: \*\*proposed\. The product owner has approved no text of this file\.\*\*/,
  );
  const { policy, authority } = await templateLawPolicy();
  assert.equal(policy.ownerApproved, false);
  assert.match(policy.version, /^r1-template-law-development-1:[a-f0-9]{16}$/);
  assert.deepEqual(policy.allowedClasses, ["general_template"]);
  assert.deepEqual(policy.jurisdictions, ["NG"]);
  assert.ok(!policy.risks.includes("general"), "every such template takes the enhanced checks");
  assert.equal(policy.developmentOnly, true);
  assert.deepEqual(policy.officialHosts, [...guidanceOfficialHosts]);
  // The policy binds the file: its hash, and each sentence the code depends on.
  assert.equal(authority[0]!.hash, sha256(policyFile));
  assert.deepEqual(
    policy.authorityRefs!.map((ref) => ref.quote),
    [...templateLawPolicySentences],
  );
  assert.ok(policy.authorityRefs!.every((ref) => ref.hash === sha256(policyFile)));
  // It is a policy of its own, apart from the templates' policy and the guides'.
  for (const other of [(await operationalPolicy()).policy, (await guidancePolicy()).policy]) {
    assert.notEqual(policy.hash, other.hash);
    assert.notEqual(policy.version, other.version);
  }
});

test("an approval is of the file's exact text, and a file missing a sentence or a host is refused", async () => {
  const approved = await templateLawPolicy({ approvedHash: sha256(policyFile) });
  assert.equal(approved.policy.ownerApproved, true, "a test's supposed approval of this very text");
  const edited = policyFile.replace("every 30 days", "every 60 days");
  assert.notEqual(edited, policyFile);
  const afterEdit = await templateLawPolicy({ approvedHash: sha256(policyFile), read: supposed(edited) });
  assert.equal(afterEdit.policy.ownerApproved, false, "an edit ends an approval");
  assert.notEqual(afterEdit.policy.version, approved.policy.version);

  await assert.rejects(
    () =>
      templateLawPolicy({
        read: supposed(policyFile.replace("is never presented as a legal duty", "may be presented as one")),
      }),
    /TEMPLATE_LAW_POLICY_EXCERPT_MISSING/,
  );
  await assert.rejects(
    () => templateLawPolicy({ read: supposed(policyFile.replace("`ndpc.gov.ng`", "ndpc.gov.ng")) }),
    /TEMPLATE_LAW_POLICY_HOST_NOT_LISTED:ndpc\.gov\.ng/,
  );
});

test("the owner's restriction file narrows it as it narrows the other policies", async () => {
  const reason = "A synthetic restriction for this test only, standing for no real decision.";
  const suspended = await templateLawPolicy({
    read: supposed(policyFile, { version: "synthetic-1", reason, suspended: true }),
  });
  assert.deepEqual(suspended.policy.allowedClasses, []);
  assert.match(suspended.policy.version, /\/restriction:synthetic-1$/);
  const noTemplates = await templateLawPolicy({
    read: supposed(policyFile, { version: "synthetic-2", reason, excludedClasses: ["general_template"] }),
  });
  assert.deepEqual(noTemplates.policy.allowedClasses, []);
  const noNigeria = await templateLawPolicy({
    read: supposed(policyFile, { version: "synthetic-3", reason, excludedJurisdictions: ["NG"] }),
  });
  assert.deepEqual(noNigeria.policy.jurisdictions, []);
});

test("the publisher checks a template that rests on the law only against this policy", () => {
  assert.equal(
    releasePolicyKind({ contentClass: "general_template", evidenceMode: "original_operational" }),
    "templates",
  );
  assert.equal(
    releasePolicyKind({ contentClass: "general_template", evidenceMode: "regulatory" }),
    "template_law",
  );
  // A template that does not say it is an original form that quotes no law is taken to rest on the law.
  assert.equal(releasePolicyKind({ contentClass: "general_template" }), "template_law");
  assert.equal(
    releasePolicyKind({ contentClass: "sourced_guidance", evidenceMode: "regulatory" }),
    "guidance",
  );
  assert.equal(
    releasePolicyKind({ contentClass: "practical_guide", evidenceMode: "original_operational" }),
    "practical_guide",
  );
});

/**
 * Stand-in passages for TPL-31's quotations. Their words hold the quoted words and are otherwise not
 * the Act's or the directive's, so their checksums are not the recorded ones and no source is current.
 */
const retrievedAt = "2026-11-27T09:00:00.000Z";
const standIn = (id: string, words: string): GuidePassage => {
  const recorded = capturedPassages.find((p) => p.id === id)!;
  const of = capturedTexts.find((t) => t.id === recorded.text)!;
  return {
    id,
    recordedLocator: recorded.recordedLocator,
    text: words,
    hash: sha256(words),
    sections: [...recorded.sections],
    instrument: {
      id: of.id,
      kind: of.kind,
      url: "https://ndpc.gov.ng/synthetic-stand-in.pdf",
      rawSha256: null,
      title: of.title,
      issuingBody: of.issuingBody,
      retrievedAt,
      effectiveFrom: of.effectiveFrom,
    },
  };
};
const standIns = new Map(
  [
    standIn(
      "NDPA-29",
      "29.—(1) Where a data controller engages the services of a data (stand-in words) engaged data processor — (stand-in words).",
    ),
    standIn(
      "GAID-34",
      "Article 34: Data Processing Agreement (stand-in words) every data controller or data processor shall (stand-in words) carry out data processing.",
    ),
    standIn(
      "NDPA-40",
      "40.—(1) Where a personal data breach has occurred (stand-in words) under this section.",
    ),
  ].map((p) => [p.id, p]),
);
const standInPassages: GuidePassages = (id) => standIns.get(id);

test("TPL-31 built from stand-in passages is held: its sources are not current and its legal scope is unverified", async () => {
  assert.deepEqual([...standIns.keys()].sort(), lawTemplatePassageIds("TPL-31").sort());
  const now = new Date("2026-11-27T10:00:00.000Z");
  const built = await buildLawTemplateCandidate("TPL-31", 1, standInPassages, now);
  const c = built.candidate;
  assert.equal(c.contentClass, "general_template");
  assert.equal(c.evidenceMode, "regulatory");
  assert.equal(c.risk, "contracts");
  assert.deepEqual(c.coverage, { kind: "template", industrySlugs: [], locationIds: [] });
  assert.equal(c.scope, TEMPLATE_LAW_SCOPE);
  assert.equal(c.limitations, TEMPLATE_LAW_LIMITATIONS);
  assert.equal(c.sourceCheckDate, retrievedAt);
  assert.equal(Date.parse(c.reviewBy!) - Date.parse(retrievedAt), 30 * 86_400_000);
  // Each sentence about the law is a claim, bound to its stand-in passage.
  assert.equal(c.claims.length, 3);
  assert.ok(c.claims.every((claim) => claim.kind === "interpretation"));
  assert.deepEqual([...new Set(c.claims.map((claim) => claim.sourceId))].sort(), [
    "GAID-34",
    "NDPA-29",
    "NDPA-40",
  ]);
  // No source is current, so the legal scope is unverified and the reasons are listed.
  assert.ok(built.sources.every((s) => s.status === "held"));
  assert.equal(c.legalScopeStatus, "unverified");
  assert.equal(c.missingEvidence.length, 3);
  assert.ok(c.missingEvidence.every((line) => /is not marked current/.test(line)));
  // The contract's assumptions and the clauses it leaves open are the candidate's assumptions.
  const contract = privacyTemplateClaimMaps[0]!.contract!;
  assert.ok(contract.parties.every((line) => c.assumptions.includes(line)));
  assert.ok(
    contract.openClauses.every((clause) =>
      c.assumptions.includes(`Left for the parties to settle: ${clause}`),
    ),
  );
  // Its file shows what it covers, its limits, what it assumes and leaves open, its sources and when
  // they were checked, after the template's own words.
  const document = JSON.parse(c.body) as { content: { blocks: { id: string; text: string }[] } };
  const block = (id: string) => document.content.blocks.find((b) => b.id === id)?.text ?? "";
  assert.ok(block(TEMPLATE_LAW_PART.covers).includes(TEMPLATE_LAW_SCOPE));
  assert.ok(block(TEMPLATE_LAW_PART.limits).includes(TEMPLATE_LAW_LIMITATIONS));
  assert.equal(block(TEMPLATE_LAW_PART.open), contract.openClauses.join("\n"));
  assert.match(
    block(TEMPLATE_LAW_PART.sources),
    /^Nigeria Data Protection Act 2023: section 40\(1\); section 29\(1\)\. https:/m,
  );
  assert.match(
    block(TEMPLATE_LAW_PART.sources),
    /Directive 2025: Article 34: Data Processing Agreement\. https:/,
  );
  assert.ok(block(TEMPLATE_LAW_PART.sourcesChecked).includes(retrievedAt));
  assert.equal(document.content.blocks[0]!.text, "Data processing agreement");

  // The gate holds it, under the policy as it stands and under a supposed approval of its text.
  const bundle = (policy: PublicationBundle["policy"]): PublicationBundle => ({
    ...heldSourceBundle(now),
    candidate: c,
    sources: built.sources,
    policy,
  });
  const unapproved = evaluatePublication(bundle((await templateLawPolicy()).policy), now);
  assert.equal(unapproved.decision, "hold");
  for (const reason of [
    "policy_not_owner_approved",
    "legal_scope_unverified",
    "material_uncertainty",
    "source_unresolved:NDPA-29",
    "review_required:factual",
  ])
    assert.ok(unapproved.reasons.includes(reason), reason);
  const supposedApproval = (await templateLawPolicy({ approvedHash: sha256(policyFile) })).policy;
  const approved = evaluatePublication(bundle(supposedApproval), now);
  assert.equal(approved.decision, "hold");
  assert.ok(!approved.reasons.includes("policy_not_owner_approved"));
  assert.ok(approved.reasons.includes("legal_scope_unverified"));
  // The templates' own policy allows its class and its risk, so the gate alone would not keep it from
  // that policy: the publisher never asks that policy about a template that rests on the law.
  const underTemplates = evaluatePublication(bundle((await operationalPolicy()).policy), now);
  assert.ok(!underTemplates.reasons.includes("class_outside_policy"));
  assert.ok(!underTemplates.reasons.includes("risk_outside_policy"));
  assert.equal(releasePolicyKind(c), "template_law");
});

test("a template without a claim map, or with no source supplied, is not built", async () => {
  await assert.rejects(
    () => buildLawTemplateCandidate("TPL-13", 1, standInPassages),
    /TEMPLATE_CLAIM_MAP_MISSING:TPL-13/,
  );
  await assert.rejects(
    () => buildLawTemplateCandidate("TPL-31", 1, () => undefined),
    /TEMPLATE_HAS_NO_BOUND_SOURCE:TPL-31/,
  );
});
