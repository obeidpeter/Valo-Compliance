import test, { after } from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { AmendmentRecord } from "./guidance-amendments";
import { closeRenderer, renderDocument } from "../../lib/valo-render";
import { controlledTermsSnapshot, keptAs } from "./guidance-release.fixtures";
import { guideOpenReasons } from "./guidance-release";
import { inspectOperationalExports } from "./operational-export-inspection";
import { readTemplateIntake } from "./operational-intake";
import { chatGPTPermissionRecord } from "./rights-applicability";
import { TEMPLATE_LAW_REVIEW_MEANING } from "./template-law-candidate";
import { lawTemplateMechanicalChecks } from "./template-law-mechanical";
import { templateLawPolicy } from "./template-law-policy";
import {
  assembledLawTemplate,
  passingFormat,
  standInWords,
  supposedlyApprovedTemplateLawPolicy,
  syntheticLawTemplateRecords,
} from "./template-law-release.fixtures";
import { templateWords } from "./template-claim-map";
import {
  lawTemplateOwnWords,
  lawTemplateRightsProblems,
  lawTemplateRightsRecord,
  measureLawTemplateCopying,
  type LawTemplateRightsRecord,
} from "./template-law-rights";

/**
 * A template that states the law, short of its two reviews: its rights record, its mechanical checks
 * and its bundle (docs/architecture/reviewed-route.md, part 4). TPL-31 is built from stand-in passages
 * (template-law-release.fixtures.ts): their words hold the quoted words and are otherwise not the Act's
 * or the directive's. A synthetic amendment record stands for a search that found nothing later, and a
 * test's supposed approval of the policy file stands for the owner's. None of it is evidence about the
 * law.
 */
const now = new Date("2026-11-27T10:00:00.000Z");
const read = new Date(+now - 3_600_000).toISOString();
const words = standInWords;
const records = syntheticLawTemplateRecords(read);
const approvedPolicy = supposedlyApprovedTemplateLawPolicy;
const passing = passingFormat;
const assembled = (options: Omit<Parameters<typeof assembledLawTemplate>[0], "now" | "identity"> = {}) =>
  assembledLawTemplate({ now, ...options });
const failed = (bundle: PublicationBundle) =>
  bundle.mechanicalChecks.filter((c) => c.result !== "pass").map((c) => c.name);

type Assembled = Awaited<ReturnType<typeof assembled>>;
type MechanicalInput = Parameters<typeof lawTemplateMechanicalChecks>[0];
/**
 * The mechanical checks run again on a changed copy of an assembled bundle: the names of the checks
 * that fail. A changed candidate's hash is made again, so that only the change itself is tested. The
 * synthetic amendment records are used unless the change gives others, or none.
 */
async function failing(
  base: Assembled,
  change: {
    candidate?: (c: PublicationBundle["candidate"]) => PublicationBundle["candidate"];
    sources?: PublicationBundle["sources"];
    policy?: PublicationBundle["policy"];
    amendmentRecords?: readonly AmendmentRecord[] | undefined;
  } & Partial<Omit<MechanicalInput, "bundle" | "amendmentRecords">> = {},
) {
  const { candidate: alter, sources, policy, amendmentRecords, ...rest } = change;
  const raw = alter ? alter(base.bundle.candidate) : base.bundle.candidate;
  const { hash: _hash, ...fields } = raw;
  const searched = "amendmentRecords" in change ? amendmentRecords : records;
  const checks = await lawTemplateMechanicalChecks({
    bundle: {
      candidate: { ...raw, hash: candidateDigest(fields) },
      sources: sources ?? base.bundle.sources,
      policy: policy ?? base.bundle.policy,
    },
    canonicalBody: JSON.stringify(base.built.document),
    claimScope: base.built.claimScope,
    provenance: base.built.provenance,
    provenanceArtifactHash: base.rights.provenanceHash,
    rights: base.rights,
    applicability: base.applicability,
    snapshot: base.snapshot,
    trustedPolicy: base.policy,
    now,
    ...rest,
    ...(searched ? { amendmentRecords: searched } : {}),
  });
  return checks.filter((c) => c.result !== "pass").map((c) => c.name);
}

test("the provider's permission binds TPL-31's own wording through its row of the intake manifest", async () => {
  const { applicability, built } = await assembled({ records });
  assert.equal(applicability.verified, true);
  assert.equal(built.provenance.templateId, "TPL-31");
  // Another template's wording, not named by the manifest's row for it, is not bound.
  assert.throws(
    () =>
      chatGPTPermissionRecord(
        controlledTermsSnapshot(now),
        "words of no template",
        built.provenance.note,
        now,
        {
          path: built.provenance.path,
          notePath: "docs/content-candidates/r1-content-intake-manifest.json",
          templateId: "TPL-31",
        },
      ),
    /CHATGPT_SOURCE_HASH_NOT_BOUND/,
  );
  // Nor is a template that is neither a form nor mapped, though the manifest has a row for its words.
  const unmapped = await readTemplateIntake("TPL-13");
  assert.throws(
    () =>
      chatGPTPermissionRecord(
        controlledTermsSnapshot(now),
        unmapped.provenance.sourceText,
        unmapped.provenance.note,
        now,
        {
          path: unmapped.provenance.path,
          notePath: "docs/content-candidates/r1-content-intake-manifest.json",
          templateId: "TPL-13",
        },
      ),
    /CHATGPT_SOURCE_HASH_NOT_BOUND/,
  );
});

test("with every source current and a supposed approval of the policy, only its two reviews hold TPL-31", async () => {
  const { bundle, rightsProblems, eligibility } = await assembled({
    policy: await approvedPolicy(),
    records,
  });
  assert.equal(bundle.candidate.legalScopeStatus, "verified");
  assert.deepEqual(bundle.candidate.missingEvidence, []);
  assert.ok(bundle.sources.every((s) => s.status === "approved"));
  assert.deepEqual(rightsProblems, []);
  assert.equal(bundle.rights.status, "cleared");
  assert.deepEqual(failed(bundle), []);
  assert.equal(eligibility.decision, "hold");
  assert.deepEqual(guideOpenReasons(eligibility), [], eligibility.reasons.join(", "));
});

test("under the policy as it stands, TPL-31 is held for the owner's approval as well as its reviews", async () => {
  const { bundle, rightsProblems, eligibility } = await assembled({ records });
  assert.equal(bundle.policy.ownerApproved, false);
  assert.ok(rightsProblems.includes("rights_basis_not_approved_by_owner"));
  assert.equal(bundle.rights.status, "unknown");
  assert.deepEqual(failed(bundle), ["scope", "rights"]);
  const open = guideOpenReasons(eligibility);
  for (const reason of [
    "policy_not_owner_approved",
    "rights_not_cleared",
    "check_not_passed:scope",
    "check_not_passed:rights",
  ])
    assert.ok(open.includes(reason), reason);
});

test("a source not current, or wording copied from a passage, holds the template whatever the policy", async () => {
  // With no record of a search for later amendments, no source is current.
  const unsearched = await assembled({ policy: await approvedPolicy() });
  assert.equal(unsearched.bundle.candidate.legalScopeStatus, "unverified");
  assert.ok(failed(unsearched.bundle).includes("scope"));
  const open = guideOpenReasons(unsearched.eligibility);
  for (const reason of ["legal_scope_unverified", "material_uncertainty", "source_unresolved:NDPA-29"])
    assert.ok(open.includes(reason), reason);

  // A passage that holds more than twenty of the template's words in a row: the template would be
  // copying it. (The words are the template's own, put in the stand-in for this test.)
  const copied = {
    ...words,
    "GAID-34": `${words["GAID-34"]} The Processor processes that data only on those instructions, including approved instructions about access, disclosure, deletion and transfers, unless applicable law requires otherwise.`,
  };
  const copying = await assembled({ policy: await approvedPolicy(), records, text: copied });
  assert.ok(measureLawTemplateCopying(copying.bundle).longestSharedWords > 20);
  assert.ok(copying.rightsProblems.some((p) => p.startsWith("rights_official_text_copied:")));
  assert.ok(guideOpenReasons(copying.eligibility).includes("rights_not_cleared"));
});

test("the mechanical checks are measured from the candidate itself, and a changed candidate fails them", async () => {
  const base = await assembled({ policy: await approvedPolicy(), records });
  assert.deepEqual(await failing(base), []);
  // Its body is not the template built again.
  assert.deepEqual(
    await failing(base, {
      candidate: (c) => ({ ...c, body: c.body.replace("Data processing agreement", "Data agreement") }),
    }),
    ["schema", "required_fields"],
  );
  // A clause it leaves open is not exposed.
  assert.deepEqual(
    await failing(base, { candidate: (c) => ({ ...c, assumptions: c.assumptions.slice(0, -1) }) }),
    ["scope", "required_fields"],
  );
  // Its scope or its limits are not the ones such a template carries.
  assert.deepEqual(
    await failing(base, { candidate: (c) => ({ ...c, limitations: `${c.limitations} Synthetic.` }) }),
    ["scope"],
  );
  // It is reviewed again later than 30 days after its sources were checked: with a rights record that
  // says the same, only its dates fail; with the record as it was, its rights fail too.
  const later = new Date(Date.parse(base.bundle.candidate.reviewBy!) + 86_400_000).toISOString();
  const reviewedLater = (c: PublicationBundle["candidate"]) => ({ ...c, reviewBy: later });
  assert.deepEqual(
    await failing(base, { candidate: reviewedLater, rights: { ...base.rights, validUntil: later } }),
    ["dates"],
  );
  assert.deepEqual(await failing(base, { candidate: reviewedLater }), ["dates", "rights"]);
  // A claim's quotation is not in its source.
  assert.deepEqual(
    await failing(base, {
      candidate: (c) => ({
        ...c,
        claims: c.claims.map((claim, i) =>
          i === 0 ? { ...claim, quote: `${claim.quote} (altered)` } : claim,
        ),
      }),
    }),
    ["source_locators", "scope", "numeric_extraction", "rule_fixtures"],
  );
  // A claim reworded, still bound to its quotation, is not what the claim map yields.
  assert.deepEqual(
    await failing(base, {
      candidate: (c) => ({
        ...c,
        claims: c.claims.map((claim, i) =>
          i === 0 ? { ...claim, text: `${claim.text} (reworded)` } : claim,
        ),
      }),
    }),
    ["scope"],
  );
  // The claim map has changed since the candidate was built.
  assert.deepEqual(
    await failing(base, { claimScope: { ...base.built.claimScope, mapDigest: sha256("another claim map") } }),
    ["scope"],
  );
});

test("the checks hold the provider's terms, the policy and each source's decision to what they are now", async () => {
  const base = await assembled({ policy: await approvedPolicy(), records });
  // The provider's pages are not the pages whose passages the permission quotes.
  const changedTerms = {
    ...base.snapshot,
    pages: base.snapshot.pages.map((page) => ({ ...page, text: `${page.text} (changed)` })),
  };
  assert.deepEqual(await failing(base, { snapshot: changedTerms }), ["source_locators"]);
  // The policy the code reads today is not the candidate's: here, the owner's approval is gone.
  assert.deepEqual(await failing(base, { trustedPolicy: (await templateLawPolicy()).policy }), ["scope"]);
  // The policy no longer names the host the sources are read from.
  const narrowed = {
    ...base.policy,
    officialHosts: base.policy.officialHosts.filter((host) => host !== "ndpc.gov.ng"),
  };
  assert.deepEqual(await failing(base, { policy: narrowed, trustedPolicy: narrowed }), ["scope"]);
  // A source carries a decision its amendment record does not support.
  assert.deepEqual(
    await failing(base, {
      sources: base.bundle.sources.map((s, i) => (i === 0 ? { ...s, operativeTextConfirmed: false } : s)),
    }),
    ["scope"],
  );
  // A candidate says its legal scope is verified, though no record makes any source current.
  const unsearched = await assembled({ policy: await approvedPolicy() });
  assert.deepEqual(
    await failing(unsearched, {
      candidate: (c) => ({ ...c, legalScopeStatus: "verified" }),
      amendmentRecords: undefined,
    }),
    ["scope"],
  );
});

test("a template's words carry its notices, claim no professional review and hold no formula", async () => {
  const base = await assembled({ policy: await approvedPolicy(), records });
  const body = JSON.stringify(base.built.document);
  // The body changed, and taken as the template built again, so that only its words are tested.
  const reworded = (from: string, to: string) => {
    assert.equal(body.split(from).length, 2, from);
    const changed = body.replace(from, to);
    return {
      candidate: (c: PublicationBundle["candidate"]) => ({ ...c, body: changed }),
      canonicalBody: changed,
    };
  };
  const instructions = "The Processor processes that data only on those instructions";
  assert.deepEqual(await failing(base, reworded(instructions, `${instructions}, as lawyer-approved,`)), [
    "disclosures",
  ]);
  assert.deepEqual(await failing(base, reworded(instructions, `${instructions} (= 2 + 2)`)), ["arithmetic"]);
  assert.deepEqual(await failing(base, reworded(TEMPLATE_LAW_REVIEW_MEANING, "")), ["disclosures"]);
});

test("each condition of a template's rights record is measured again", async () => {
  const base = await assembled({ policy: await approvedPolicy(), records });
  const check = (rights: LawTemplateRightsRecord, options: { verified?: boolean; at?: Date } = {}) =>
    lawTemplateRightsProblems({
      rights,
      bundle: base.bundle,
      provenanceArtifactHash: base.rights.provenanceHash,
      applicability: { ...base.applicability, verified: options.verified ?? true },
      policy: base.bundle.policy,
      now: options.at ?? now,
    });
  const wrong = (fields: Record<string, unknown>) =>
    ({ ...base.rights, ...fields }) as LawTemplateRightsRecord;
  const official = (fields: Record<string, unknown>) =>
    wrong({ officialText: { ...base.rights.officialText, ...fields } });
  assert.deepEqual(check(base.rights), []);
  const cases: [string, LawTemplateRightsRecord, { verified?: boolean; at?: Date }?][] = [
    ["rights_record_not_for_a_template_that_states_the_law", wrong({ kind: "valo-guide-rights-1" })],
    ["rights_record_not_for_a_template_that_states_the_law", wrong({ statesLaw: false })],
    ["rights_customer_licence_marked_accepted", wrong({ customerLicenceAccepted: true })],
    ["rights_provenance_mismatch", wrong({ provenanceHash: sha256("another draft") })],
    ["rights_authoring_route_unknown", wrong({ authoringRoute: "another_route" })],
    ["rights_provider_permission_unverified", base.rights, { verified: false }],
    ["rights_provider_permission_changed", wrong({ applicabilityHash: sha256("another permission") })],
    ["rights_provider_permission_changed", wrong({ permissions: [] })],
    // Run on the day after the template's review date, which the record still names.
    [
      "rights_record_expired_or_unbound",
      base.rights,
      { at: new Date(Date.parse(base.rights.validUntil) + 1000) },
    ],
    ["rights_record_expired_or_unbound", wrong({ validUntil: new Date(+now + 86_400_000).toISOString() })],
    ["rights_official_text_rule_changed", official({ rule: "Another rule." })],
    ["rights_official_text_rule_changed", official({ policyFileHash: sha256("another policy file") })],
    // The record no longer measures what the template shares with its passages.
    ["rights_copying_measure_changed", official({ longestSharedWords: 0 })],
  ];
  for (const [reason, rights, options] of cases) assert.deepEqual(check(rights, options), [reason], reason);
  // The words measured are the template's own, as drafted: the parts added after them are left out.
  const draft = await readTemplateIntake("TPL-31");
  assert.equal(lawTemplateOwnWords(base.bundle.candidate.body), templateWords(draft.document.content.blocks));
  // A policy that names no file for its basis gives no rights record at all.
  assert.throws(
    () =>
      lawTemplateRightsRecord({
        bundle: base.bundle,
        snapshot: keptAs(base.snapshot),
        provenanceArtifactHash: base.rights.provenanceHash,
        applicability: base.applicability,
        policy: { ...base.bundle.policy, authorityRefs: [] },
        now,
      }),
    /TEMPLATE_RIGHTS_INPUT_INCOMPLETE/,
  );
});

test("a file that fails its inspection holds the template", async () => {
  const { eligibility } = await assembled({
    policy: await approvedPolicy(),
    records,
    pdf: { ...passing, parsed: false },
  });
  assert.deepEqual(guideOpenReasons(eligibility), ["export_not_passed:pdf"]);
});

test("TPL-31's Word and PDF files hold its whole document and pass the export inspection", async () => {
  after(closeRenderer);
  const { built } = await assembled({ policy: await approvedPolicy(), records });
  const files = {
    docx: await renderDocument(built.document, "docx", 1, "template_sample"),
    pdf: await renderDocument(built.document, "pdf", 1, "template_sample"),
  };
  const report = await inspectOperationalExports(built.candidate, files);
  assert.equal(report.passed, true, JSON.stringify(report.formats));
  for (const format of ["docx", "pdf"] as const) {
    const f = report.formats[format];
    assert.deepEqual(
      [f.parsed, f.disclosureIncluded, f.scopeIncluded, f.limitationsIncluded, f.sourceDateIncluded],
      [true, true, true, true, true],
      format,
    );
  }
});
