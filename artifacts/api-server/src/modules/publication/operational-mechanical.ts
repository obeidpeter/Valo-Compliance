import {
  candidateDigest,
  isPracticalGuideId,
  digest,
  disclosure,
  mandatoryMechanicalChecks,
  publicationSchema,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { candidateArithmetic } from "./candidate-arithmetic";
import { claimLocatorMatches } from "./claim-locator";
import { supportsOperationalInferenceTemplate } from "./inference-operational-coverage";
type Provenance = {
  hash: string;
  sourceText: string;
  note: string;
  noteHash: string;
  templateId: string;
  version: number;
};
type Rights = {
  applicabilityHash: string;
  provenanceHash: string;
  validUntil: string;
  permissions: { url: string; hash: string; quote: string }[];
};
type Snapshot = { retrievedAt: string; pages: { url: string; text: string; truncated: boolean }[] };

/** Re-executable checks for this narrow blank operational form. No model
 * verdict, check-name list or generic digest stands in for a measured result.
 * Legal claims/rules are NOT supported by this validator. */
export function operationalMechanicalChecks(input: {
  candidate: PublicationBundle["candidate"];
  policy: PublicationBundle["policy"];
  provenance: Provenance;
  provenanceArtifactHash: string;
  rights: Rights;
  applicability: { verified: boolean; hash: string };
  snapshot: Snapshot;
  now?: Date;
  sources?: PublicationBundle["sources"];
}): PublicationBundle["mechanicalChecks"] {
  const { candidate: c, policy: p, provenance: v, rights: r, snapshot: s, applicability: a } = input;
  const now = +(input.now ?? new Date());
  let raw: unknown;
  try {
    raw = JSON.parse(c.body);
  } catch {
    raw = null;
  }
  const parsed = documentInput.safeParse(raw);
  const schema = publicationSchema.shape.candidate.safeParse(c);
  const sourceBound =
    sha256(v.sourceText) === v.hash &&
    sha256(v.note) === v.noteHash &&
    v.templateId === c.id &&
    v.version === c.version;
  const templateId = /^TPL-(0[1-9]|[12]\d|3\d|40)$/.test(c.id);
  const mandatoryRisk: Record<string, string> = {
    "TPL-13": "contracts",
    "TPL-14": "contracts",
    "TPL-15": "contracts",
    "TPL-16": "employment",
    "TPL-17": "employment",
    "TPL-18": "contracts",
    "TPL-19": "contracts",
    "TPL-20": "contracts",
    "TPL-21": "contracts",
    "TPL-23": "contracts",
    "TPL-25": "governance",
    "TPL-26": "employment",
    "TPL-27": "employment",
    "TPL-28": "employment",
    "TPL-29": "privacy",
    "TPL-30": "contracts",
    "TPL-31": "privacy",
    "TPL-32": "privacy",
    "TPL-33": "regulated_sector",
    "TPL-36": "regulated_sector",
    "TPL-37": "regulated_sector",
    "TPL-39": "contracts",
  };
  const practical =
    isPracticalGuideId(c.id) && c.contentClass === "practical_guide" && c.coverage?.kind === "guide";
  const originalScope =
    ((supportsOperationalInferenceTemplate(c.id) && c.contentClass === "general_template") || practical) &&
    c.risk === "general" &&
    c.evidenceMode === "original_operational" &&
    c.legalScopeStatus === "not_applicable" &&
    c.claims.length === 0;
  const sources = input.sources ?? [];
  const sourceFacts = c.claims.map((claim) => {
    const source = sources.find((s) => s.id === claim.sourceId);
    return {
      claimHash: digest(claim),
      bound: Boolean(
        source &&
        sha256(source.text) === source.hash &&
        source.status === "approved" &&
        source.operativeTextConfirmed &&
        source.amendmentsResolved &&
        claimLocatorMatches(source.text, claim.quote, claim.locator) &&
        claim.numbers.every((n) => claim.quote.includes(n)) &&
        Date.parse(source.freshUntil) > now &&
        Date.parse(source.retrievedAt) <= now &&
        Date.parse(source.effectiveFrom) <= now &&
        (source.effectiveTo === null || Date.parse(source.effectiveTo) > now),
      ),
    };
  });
  const sourcedScope =
    c.evidenceMode === "regulatory" &&
    c.legalScopeStatus === "verified" &&
    (templateId || c.contentClass === "sourced_guidance") &&
    sourceFacts.length > 0 &&
    sourceFacts.every((s) => s.bound);
  const scope =
    (originalScope || sourcedScope) &&
    (!mandatoryRisk[c.id] || mandatoryRisk[c.id] === c.risk) &&
    p.ownerApproved &&
    p.developmentOnly === true &&
    (!(practical || c.contentClass === "general_template") ||
      Boolean(p.originalOperationalIds?.includes(c.id))) &&
    p.allowedClasses.includes(c.contentClass) &&
    p.jurisdictions.includes(c.jurisdiction) &&
    p.risks.includes(c.risk);
  const passages = r.permissions.map((e) => {
    const page = s.pages.find((page) => page.url === e.url);
    return {
      url: e.url,
      hash: e.hash,
      found: Boolean(
        page &&
        page.truncated === false &&
        e.quote.trim() &&
        e.url.startsWith("https://") &&
        sha256(page.text) === e.hash &&
        page.text.includes(e.quote),
      ),
    };
  });
  const checked = Date.parse(c.sourceCheckDate),
    expiry = Date.parse(c.reviewBy ?? "");
  const fetched = Date.parse(s.retrievedAt);
  const dates =
    Number.isFinite(checked) &&
    Number.isFinite(expiry) &&
    Number.isFinite(fetched) &&
    checked <= now &&
    expiry > now &&
    expiry > checked &&
    fetched <= checked &&
    checked - fetched <= 86400000 &&
    r.validUntil === c.reviewBy;
  const blankFields =
    parsed.success && Object.values(parsed.data.content.fields).every((value) => value === "");
  const text = parsed.success ? parsed.data.content.blocks.map((b) => b.text).join("\n") : "";
  // Integer-scaled quantities, including a negative balance and values beyond
  // JS's safe integer limit. These are operational controls, NOT legal fixtures.
  const arithmetic = candidateArithmetic(c);
  const facts = {
    schema: {
      pass:
        schema.success &&
        parsed.success &&
        candidateDigest(c) === c.hash &&
        digest(parsed.data) === digest(raw),
      documentParsed: parsed.success,
      canonicalHash: c.hash,
    },
    source_locators: {
      pass:
        sourceBound &&
        passages.length > 0 &&
        passages.every((e) => e.found) &&
        (originalScope || sourcedScope),
      sourceBound,
      passages,
      sourceFacts,
    },
    dates: {
      pass: dates,
      checked: c.sourceCheckDate,
      reviewBy: c.reviewBy,
      providerFetchedAt: s.retrievedAt,
    },
    scope: { pass: scope, template: c.id, policy: p.version, originalScope },
    numeric_extraction: {
      pass: (originalScope && blankFields) || (sourcedScope && sourceFacts.every((s) => s.bound)),
      legalClaimCount: c.claims.length,
      blankBusinessFields: blankFields,
      applicability: practical
        ? "Fictional worked examples checked against the original article."
        : "No regulatory numbers or claims; user facts must remain blank in this reusable master",
    },
    rights: {
      pass: a.verified && r.applicabilityHash === a.hash && r.provenanceHash === input.provenanceArtifactHash,
      providerPermissionVerified: a.verified,
      applicabilityHash: a.hash,
      provenanceArtifactHash: input.provenanceArtifactHash,
    },
    required_fields: {
      pass:
        blankFields &&
        parsed.success &&
        sourceBound &&
        v.sourceText.toLowerCase().includes(parsed.data.title.toLowerCase()) &&
        parsed.data.content.blocks.length >= 5 &&
        text.includes(practical ? "What it covers:" : "Scope:") &&
        text.includes(practical ? "Limits you should know:" : "Limitations:"),
      ...(practical ? { articleFieldsEmpty: blankFields } : { blankReusableMaster: blankFields }),
      blockCount: parsed.success ? parsed.data.content.blocks.length : 0,
    },
    disclosures: {
      pass:
        c.disclosure === disclosure &&
        text.includes(disclosure) &&
        !/^(?:lawyer.approved|professionally verified|guaranteed compliant)[.! ]*$/im.test(text) &&
        text.includes(c.sourceCheckDate) &&
        text.includes("two separate automated AI checks") &&
        text.includes("not legal or regulatory verification"),
      requiredNotice: disclosure,
    },
    arithmetic,
    rule_fixtures: {
      pass: originalScope || (sourcedScope && sourceFacts.every((s) => s.bound)),
      legalClaimCount: c.claims.length,
      legalScopeStatus: c.legalScopeStatus,
      applicability: "No legal rules in this original operational master; this does not pass RUL-008",
    },
  };
  return mandatoryMechanicalChecks.map((name) => ({
    name,
    candidateHash: c.hash,
    result: facts[name].pass ? "pass" : "fail",
    evidenceHash: digest({ validator: "operational-mechanical-1", name, ...facts[name] }),
  }));
}
