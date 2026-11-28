import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";
import { GUIDE_SHARED_WORDS_LIMIT } from "./guidance-copying";
import { publicationWorkspaceRoot } from "./operational-policy";
import { operationalRestrictionsSchema } from "./operational-restrictions";
import { guidanceOfficialHosts } from "../../platform/guidance-hosts";

/**
 * The source-backed publication policy for templates that state the law
 * (docs/architecture/reviewed-route.md, part 4).
 *
 * The owner's recorded authority for templates says claims about law need a source-backed policy of
 * their own, so a template whose claim map states the law is never released under the templates'
 * own policy. This one is read from the policy file, and it counts as approved only while the file is,
 * byte for byte, a text the owner approved.
 */
export const TEMPLATE_LAW_POLICY_PATH = "docs/valo/policies/template-law-publication-policy.md";
/** The owner's optional narrowing of what may be published. It can only take permissions away. */
const RESTRICTIONS_PATH = "docs/valo/policies/operational-publication-restrictions.json";

/**
 * The SHA-256 of the policy file as the product owner approved it. Null: the owner has approved no
 * text, so every template that states the law is held with `policy_not_owner_approved`.
 *
 * Change this only on the owner's explicit, current approval of a file's exact text, and for no
 * other reason. Any edit of the file ends an approval until the owner approves the new text.
 */
export function templateLawPolicyApprovedHash(): string | null {
  return null;
}

/**
 * The most a review request for such a template may measure before it is refused unsent, by the
 * budget's cautious count: every byte counted as a token, plus an allowance. It is a guide's limit:
 * like a guide's, the request carries the official passages the template rests on. The policy file
 * states this number, for the owner to approve with it.
 */
export const TEMPLATE_LAW_REVIEW_INPUT_CEILING = 64_000;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");

/** Sentences of the policy file the code depends on. The policy is refused if the file lacks one. */
export const templateLawPolicySentences = [
  "Each sentence that says what the law requires is bound to an exact passage of an official text that Valo holds a copy of.",
  "A term the parties choose is recorded as a term and is never presented as a legal duty.",
  "A rate, fee, penalty, threshold or deadline appears only when the quoted passage contains that number.",
  "A contract template states the assumptions it makes about its parties and its use, and lists the clauses it leaves for the parties to settle.",
  `A template does not reproduce official text beyond a short quotation: no more than ${GUIDE_SHARED_WORDS_LIMIT} words in a row from a passage it cites.`,
  "An AI review is never called a professional review.",
  `A template's review is refused before it is sent if it measures more than ${thousands(TEMPLATE_LAW_REVIEW_INPUT_CEILING)} by the budget's cautious count`,
  "This policy allows publication in the development environment.",
] as const;

const oneLine = (text: string) => text.replace(/\s+/g, " ");

/**
 * The policy a template that states the law is prepared and released under. `approvedHash` and
 * `read` are for tests of the gates beyond approval; the publisher always uses the recorded approval
 * and the real file.
 */
export async function templateLawPolicy(
  options: { approvedHash?: string | null; read?: (path: string) => Promise<string> } = {},
) {
  const read =
    options.read ?? ((path: string) => readFile(resolve(publicationWorkspaceRoot(), path), "utf8"));
  const approvedHash =
    options.approvedHash === undefined ? templateLawPolicyApprovedHash() : options.approvedHash;
  const text = await read(TEMPLATE_LAW_POLICY_PATH),
    fileHash = sha256(text),
    flat = oneLine(text);
  for (const sentence of templateLawPolicySentences)
    if (!flat.includes(sentence)) throw Error("TEMPLATE_LAW_POLICY_EXCERPT_MISSING");
  for (const host of guidanceOfficialHosts)
    if (!text.includes(`\`${host}\``)) throw Error(`TEMPLATE_LAW_POLICY_HOST_NOT_LISTED:${host}`);
  const body = {
    // Each text of the policy file is a policy version of its own.
    version: `r1-template-law-development-1:${fileHash.slice(0, 16)}`,
    ownerApproved: approvedHash !== null && approvedHash === fileHash,
    allowedClasses: ["general_template"],
    jurisdictions: ["NG"],
    // Never "general": every subject such a template covers is treated as high impact.
    risks: ["tax", "employment", "privacy", "governance", "contracts", "regulated_sector"],
    officialHosts: [...guidanceOfficialHosts],
    blockedActivities: [
      "bespoke_legal_opinions",
      "compliance_or_exemption_determinations",
      "invented_tax_rates",
      "guaranteed_legal_validity",
      "professional_review_claims",
      "government_filings",
      "sales",
      "public_launch",
      "confidential_customer_data",
      "payment_movement",
    ],
    authorityRefs: templateLawPolicySentences.map((quote): { path: string; hash: string; quote: string } => ({
      path: TEMPLATE_LAW_POLICY_PATH,
      hash: fileHash,
      quote,
    })),
    developmentOnly: true,
  };
  // The owner's restriction file stops these templates as it stops the others: a suspension, or an
  // exclusion of templates or of Nigeria, takes that permission out of this policy too.
  let restricted: typeof body = body;
  let restrictionText: string | undefined;
  try {
    restrictionText = await read(RESTRICTIONS_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (restrictionText !== undefined) {
    const restrictions = operationalRestrictionsSchema.parse(JSON.parse(restrictionText));
    restricted = {
      ...body,
      version: `${body.version}/restriction:${restrictions.version}`,
      allowedClasses: restrictions.suspended
        ? []
        : body.allowedClasses.filter((x) => !restrictions.excludedClasses.includes(x)),
      jurisdictions: body.jurisdictions.filter((x) => !restrictions.excludedJurisdictions.includes(x)),
      authorityRefs: [
        ...body.authorityRefs,
        { path: RESTRICTIONS_PATH, hash: digest(restrictions), quote: restrictions.reason },
      ],
    };
  }
  const policy: PublicationBundle["policy"] = { ...restricted, hash: digest(restricted) };
  return { policy, authority: [{ path: TEMPLATE_LAW_POLICY_PATH, hash: fileHash, text }] };
}

/**
 * Which policy the publisher checks a candidate against. A template that rests on the law, which is
 * any template not prepared as an original form that quotes no law, is checked only against this
 * policy, never the templates' own one, so that no claim about law is released under the templates'
 * authority (docs/valo/policies/operational-publication-authority.md).
 */
export function releasePolicyKind(
  candidate: Pick<PublicationBundle["candidate"], "contentClass" | "evidenceMode">,
) {
  if (candidate.contentClass === "practical_guide") return "practical_guide" as const;
  if (candidate.contentClass === "sourced_guidance") return "guidance" as const;
  return candidate.evidenceMode === "original_operational"
    ? ("templates" as const)
    : ("template_law" as const);
}
