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
import { guideClaimScopeProblems, type GuideClaimScope } from "./guidance-bundle";
import { GUIDE_LIMITATIONS, GUIDE_REVIEW_DAYS, GUIDE_SCOPE } from "./guidance-candidate";
import { GUIDE_REVIEW_MEANING, guidePageText } from "./guidance-document";
import { guideRightsProblems, type GuideRightsRecord } from "./guidance-rights";
import type { AmendmentRecord } from "./guidance-amendments";

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
const guideId = /^GUD-(0[1-9]|[12]\d|30)$/;
/** Words a guide may never use of itself (policy point 6, EDP-008). */
const professionalClaim =
  /lawyer.approved|professionally (?:verified|reviewed|certified)|guaranteed (?:compliant|valid)|reviewed by (?:a|our) (?:lawyer|solicitor|tax adviser|accountant|regulator)/i;
/** A formula. A guide explains; it computes nothing, and no check here could verify a calculation. */
const formula = /[=×÷]|\d\s*[+*]\s*\d/;
const address = /https?:\/\/[^\s)]+/g;

/**
 * The mechanical checks for a guide that says what the law requires: the ten checks the gate
 * requires, each measured from the candidate itself. No model verdict and no list of names stands
 * in for a result. They are run when a guide is prepared and again, from the stored candidate, when
 * it is released; a result that changes in between stops the release.
 *
 * These are checks of binding and form. They are not legal, tax or regulatory review.
 */
export async function guideMechanicalChecks(input: {
  bundle: Pick<PublicationBundle, "candidate" | "sources" | "policy">;
  /** The guide's whole document, built again from the retained draft and the candidate's sources. */
  canonicalBody: string;
  claimScope: GuideClaimScope;
  provenance: Provenance;
  provenanceArtifactHash: string;
  rights: GuideRightsRecord;
  applicability: Applicability;
  snapshot: Snapshot;
  /** The guidance policy as the code reads it today. */
  trustedPolicy: PublicationBundle["policy"];
  now?: Date;
  amendmentRecords?: readonly AmendmentRecord[];
}): Promise<PublicationBundle["mechanicalChecks"]> {
  const { bundle, provenance: v, rights: r, snapshot: s, applicability: a } = input;
  const c = bundle.candidate,
    p = bundle.policy,
    now = input.now ?? new Date();
  const schema = publicationSchema.shape.candidate.safeParse(c);
  const page = guidePageText(c.body);
  const ownWords = page?.body ?? "";
  let whole = "";
  try {
    whole = (JSON.parse(c.body) as { content: { blocks: { text: string }[] } }).content.blocks
      .map((b) => b.text)
      .join("\n");
  } catch {
    whole = "";
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

  const scopeProblems = await guideClaimScopeProblems(bundle, input.claimScope, now, input.amendmentRecords);
  const official = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && p.officialHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  };
  const links = [...ownWords.matchAll(address)].map((m) => m[0]);
  const policyProblems = [
    ...(digest(p) === digest(input.trustedPolicy)
      ? []
      : ["the candidate's policy is not the guidance policy"]),
    ...(p.ownerApproved ? [] : ["the owner has not approved the guidance policy"]),
    ...(p.developmentOnly === true ? [] : ["the policy is not limited to development"]),
    ...(p.allowedClasses.includes(c.contentClass) &&
    p.jurisdictions.includes(c.jurisdiction) &&
    p.risks.includes(c.risk)
      ? []
      : ["the guide's class, place or subject is outside the policy"]),
    ...(guideId.test(c.id) && c.contentClass === "sourced_guidance" && c.coverage?.kind === "guidance"
      ? []
      : ["the candidate is not an R1 guide"]),
    ...(c.evidenceMode === "regulatory" && c.legalScopeStatus === "verified"
      ? []
      : ["the guide's legal scope is not verified"]),
    ...(c.scope === GUIDE_SCOPE && c.limitations === GUIDE_LIMITATIONS
      ? []
      : ["the guide does not carry the guides' own scope and limits"]),
    ...links.filter((url) => !official(url)).map((url) => `a link is not on an official host: ${url}`),
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
    expiry - checked === GUIDE_REVIEW_DAYS * DAY &&
    // The provider's terms were captured within the day before the rights record was made.
    fetched <= recorded &&
    recorded - fetched <= DAY &&
    recorded <= +now &&
    checked <= recorded &&
    r.validUntil === c.reviewBy &&
    bundle.sources.length > 0 &&
    // The guide's check date is the day its newest source was read; none was read after it.
    Math.max(...bundle.sources.map((source) => Date.parse(source.retrievedAt))) === checked;

  const rightsProblems = guideRightsProblems({
    rights: r,
    bundle,
    provenanceArtifactHash: input.provenanceArtifactHash,
    applicability: a,
    policy: p,
    now,
  });

  const facts = {
    schema: {
      pass:
        schema.success && page !== null && candidateDigest(c) === c.hash && c.body === input.canonicalBody,
      documentParsed: page !== null,
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
      guide: c.id,
      policy: p.version,
      claimMap: input.claimScope.mapDigest,
      problems: [...scopeProblems, ...policyProblems],
    },
    numeric_extraction: {
      // Every number a claim carries is in its quotation, and the claim map, built again, lets no
      // number in the guide stand that its quotations do not contain.
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
      // The stored body is, byte for byte, the guide built again: its own words, what it covers, its
      // limits, its sources, how it was written and checked, and when its sources were checked.
      pass: page !== null && c.body === input.canonicalBody && sourceBound,
      bodyIsCanonical: c.body === input.canonicalBody,
    },
    disclosures: {
      pass:
        c.disclosure === disclosure &&
        whole.includes(disclosure) &&
        whole.includes(c.sourceCheckDate) &&
        whole.includes(GUIDE_REVIEW_MEANING) &&
        !professionalClaim.test(whole),
      requiredNotice: disclosure,
    },
    arithmetic: {
      // An address can hold "=" and is not a formula.
      pass: page !== null && !formula.test(ownWords.replace(address, "")),
      applicability: "A guide holds no formula. Its numbers are checked against the quoted passages.",
    },
    rule_fixtures: {
      pass: claimsBound,
      legalClaimCount: c.claims.length,
      legalScopeStatus: c.legalScopeStatus,
      applicability:
        "A guide holds no executable rule. Each statement of law is bound to a quotation; this does not pass RUL-008.",
    },
  };
  return mandatoryMechanicalChecks.map((name) => ({
    name,
    candidateHash: c.hash,
    result: facts[name].pass ? "pass" : "fail",
    evidenceHash: digest({ validator: "guide-mechanical-1", name, ...facts[name] }),
  }));
}
