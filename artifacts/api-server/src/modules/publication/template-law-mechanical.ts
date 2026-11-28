import {
  candidateDigest,
  digest,
  disclosure,
  mandatoryMechanicalChecks,
  publicationSchema,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { claimLocatorMatches } from "./claim-locator";
import type { AmendmentRecord } from "./guidance-amendments";
import { contractAssumptions } from "./template-claim-map";
import {
  lawTemplateClaimScopeProblems,
  TEMPLATE_LAW_LIMITATIONS,
  TEMPLATE_LAW_REVIEW_DAYS,
  TEMPLATE_LAW_REVIEW_MEANING,
  TEMPLATE_LAW_SCOPE,
  type TemplateClaimScope,
} from "./template-law-candidate";
import { mappedLawTemplateIds, templateLawClaimMaps } from "./template-law-maps";
import {
  lawTemplateOwnWords,
  lawTemplateRightsProblems,
  type LawTemplateRightsRecord,
} from "./template-law-rights";

type Provenance = {
  hash: string;
  sourceText: string;
  note: string;
  noteHash: string;
  templateId: string;
  version: number;
};
type Snapshot = { retrievedAt: string; pages: { url: string; text: string; truncated: boolean }[] };
type Applicability = {
  record: { evidence: { url: string; hash: string; quote: string }[] };
  hash: string;
  verified: boolean;
};

const DAY = 86_400_000;
/** Words a template may never use of itself (policy point 7, EDP-008). */
const professionalClaim =
  /lawyer.approved|professionally (?:verified|reviewed|certified)|guaranteed (?:compliant|valid|enforceable)|reviewed by (?:a|our) (?:lawyer|solicitor|tax adviser|accountant|regulator)/i;
/** A formula. A template computes nothing, and no check here could verify a calculation. */
const formula = /[=×÷]|\d\s*[+*]\s*\d/;

/**
 * The mechanical checks for a template that states the law: the ten checks the gate requires, each
 * measured from the candidate itself, as a guide's are. No model verdict and no list of names stands
 * in for a result. They are run when a template is prepared and again, from the stored candidate,
 * when it is released; a result that changes in between stops the release.
 *
 * These are checks of binding and form. They are not legal, tax or regulatory review.
 */
export async function lawTemplateMechanicalChecks(input: {
  bundle: Pick<PublicationBundle, "candidate" | "sources" | "policy">;
  /** The template's whole document, built again from the retained draft and the candidate's sources. */
  canonicalBody: string;
  claimScope: TemplateClaimScope;
  provenance: Provenance;
  provenanceArtifactHash: string;
  rights: LawTemplateRightsRecord;
  applicability: Applicability;
  snapshot: Snapshot;
  /** The policy for templates that state the law, as the code reads it today. */
  trustedPolicy: PublicationBundle["policy"];
  now?: Date;
  amendmentRecords?: readonly AmendmentRecord[];
}): Promise<PublicationBundle["mechanicalChecks"]> {
  const { bundle, provenance: v, rights: r, snapshot: s, applicability: a } = input;
  const c = bundle.candidate,
    p = bundle.policy,
    now = input.now ?? new Date();
  const map = templateLawClaimMaps.find((m) => m.id === c.id);
  const schema = publicationSchema.shape.candidate.safeParse(c);
  let own: string | null = null,
    whole = "";
  try {
    own = lawTemplateOwnWords(c.body);
    whole = (
      JSON.parse(c.body) as { content: { blocks: { text: string; rows: string[][] }[] } }
    ).content.blocks
      .map((b) => [b.text, ...b.rows.flat()].join("\n"))
      .join("\n");
  } catch {
    own = null;
  }

  const sourceBound =
    sha256(v.sourceText) === v.hash &&
    sha256(v.note) === v.noteHash &&
    v.templateId === c.id &&
    v.version === c.version;
  const permissions = a.record.evidence.map((e) => {
    const terms = s.pages.find((x) => x.url === e.url);
    return {
      url: e.url,
      hash: e.hash,
      found: Boolean(
        terms &&
        terms.truncated === false &&
        e.quote.trim() &&
        e.url.startsWith("https://") &&
        sha256(terms.text) === e.hash &&
        terms.text.includes(e.quote),
      ),
    };
  });
  const claimFacts = c.claims.map((claim) => {
    const source = bundle.sources.find((x) => x.id === claim.sourceId);
    return {
      claimHash: digest(claim),
      bound: Boolean(
        source &&
        sha256(source.text) === source.hash &&
        source.text.includes(claim.quote) &&
        claimLocatorMatches(source.text, claim.quote, claim.locator) &&
        claim.numbers.every((n) => claim.quote.includes(n)),
      ),
    };
  });
  const claimsBound = claimFacts.length > 0 && claimFacts.every((f) => f.bound);

  const scopeProblems = await lawTemplateClaimScopeProblems(
    bundle,
    input.claimScope,
    now,
    input.amendmentRecords,
  );
  const official = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && p.officialHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  };
  const policyProblems = [
    ...(digest(p) === digest(input.trustedPolicy)
      ? []
      : ["the candidate's policy is not the policy for templates that state the law"]),
    ...(p.ownerApproved ? [] : ["the owner has not approved the policy for templates that state the law"]),
    ...(p.developmentOnly === true ? [] : ["the policy is not limited to development"]),
    ...(p.allowedClasses.includes(c.contentClass) &&
    p.jurisdictions.includes(c.jurisdiction) &&
    p.risks.includes(c.risk)
      ? []
      : ["the template's class, place or subject is outside the policy"]),
    ...(mappedLawTemplateIds.includes(c.id) &&
    c.contentClass === "general_template" &&
    c.coverage?.kind === "template"
      ? []
      : ["the candidate is not a mapped template that states the law"]),
    ...(c.evidenceMode === "regulatory" && c.legalScopeStatus === "verified"
      ? []
      : ["the template's legal scope is not verified"]),
    ...(c.scope === TEMPLATE_LAW_SCOPE && c.limitations === TEMPLATE_LAW_LIMITATIONS
      ? []
      : ["the template does not carry the scope and limits of templates that state the law"]),
    ...bundle.sources
      .filter((source) => !official(source.url))
      .map((source) => `a source is not on an official host: ${source.id}`),
  ];

  const checked = Date.parse(c.sourceCheckDate),
    expiry = Date.parse(c.reviewBy ?? ""),
    fetched = Date.parse(s.retrievedAt),
    recorded = Date.parse(r.checkedAt);
  const dates =
    [checked, expiry, fetched, recorded].every(Number.isFinite) &&
    checked <= +now &&
    expiry > +now &&
    expiry - checked === TEMPLATE_LAW_REVIEW_DAYS * DAY &&
    // The provider's terms were captured within the day before the rights record was made.
    fetched <= recorded &&
    recorded - fetched <= DAY &&
    recorded <= +now &&
    checked <= recorded &&
    r.validUntil === c.reviewBy &&
    bundle.sources.length > 0 &&
    // The check date is the day its newest source was read; none was read after it.
    Math.max(...bundle.sources.map((source) => Date.parse(source.retrievedAt))) === checked;

  const rightsProblems = lawTemplateRightsProblems({
    rights: r,
    bundle,
    provenanceArtifactHash: input.provenanceArtifactHash,
    applicability: a,
    policy: p,
    now,
  });
  // A contract states the parties and use it assumes and the clauses it leaves open (EDP-005).
  const exposed =
    !!map && (!map.contract || digest(c.assumptions) === digest(contractAssumptions(map.contract)));

  const facts = {
    schema: {
      pass: schema.success && own !== null && candidateDigest(c) === c.hash && c.body === input.canonicalBody,
      documentParsed: own !== null,
      canonicalHash: c.hash,
    },
    source_locators: {
      pass: sourceBound && permissions.length > 0 && permissions.every((e) => e.found) && claimsBound,
      sourceBound,
      permissions,
      claimFacts,
    },
    dates: {
      pass: dates,
      checked: c.sourceCheckDate,
      reviewBy: c.reviewBy,
      providerFetchedAt: s.retrievedAt,
      rightsCheckedAt: r.checkedAt,
    },
    scope: {
      pass: scopeProblems.length === 0 && policyProblems.length === 0,
      template: c.id,
      policy: p.version,
      claimMap: input.claimScope.mapDigest,
      problems: [...scopeProblems, ...policyProblems],
    },
    numeric_extraction: {
      // Every number a claim carries is in its quotation, and the claim map, built again, lets no
      // number in the template stand that its quotations do not contain.
      pass: claimsBound && !scopeProblems.some((problem) => problem.includes("no longer builds")),
      legalClaimCount: c.claims.length,
      numbers: c.claims.reduce((count, claim) => count + claim.numbers.length, 0),
    },
    rights: {
      pass: rightsProblems.length === 0,
      problems: rightsProblems,
      applicabilityHash: a.hash,
      provenanceArtifactHash: input.provenanceArtifactHash,
    },
    required_fields: {
      // The stored body is, byte for byte, the template built again, and a contract carries what it
      // assumes and leaves open.
      pass: own !== null && c.body === input.canonicalBody && sourceBound && exposed,
      bodyIsCanonical: c.body === input.canonicalBody,
      contractExposed: exposed,
    },
    disclosures: {
      pass:
        c.disclosure === disclosure &&
        whole.includes(disclosure) &&
        whole.includes(c.sourceCheckDate) &&
        whole.includes(TEMPLATE_LAW_REVIEW_MEANING) &&
        !professionalClaim.test(whole),
      requiredNotice: disclosure,
    },
    arithmetic: {
      pass: own !== null && !formula.test(own),
      applicability: "A template holds no formula. Its numbers are checked against the quoted passages.",
    },
    rule_fixtures: {
      pass: claimsBound,
      legalClaimCount: c.claims.length,
      legalScopeStatus: c.legalScopeStatus,
      applicability:
        "A template holds no executable rule. Each statement of law is bound to a quotation; this does not pass RUL-008.",
    },
  };
  return mandatoryMechanicalChecks.map((name) => ({
    name,
    candidateHash: c.hash,
    result: facts[name].pass ? "pass" : "fail",
    evidenceHash: digest({ validator: "template-law-mechanical-1", name, ...facts[name] }),
  }));
}
