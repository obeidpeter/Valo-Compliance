import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";
import { GUIDE_SHARED_WORDS_LIMIT } from "./guidance-copying";
import { publicationWorkspaceRoot } from "./operational-policy";
import { operationalRestrictionsSchema } from "./operational-restrictions";
import { guidanceOfficialHosts } from "../sources";

/**
 * The publication policy for guides that say what the law requires (decision 0017, point 1).
 *
 * The owner's recorded authority for templates says claims about law need a source-backed policy of
 * their own, so a guide is never released under the templates' policy. This one is read from the
 * policy file. The owner approved that file's text on 22 November 2026. It counts as approved only
 * while the file is, byte for byte, the text the owner approved.
 */
export const GUIDANCE_POLICY_PATH = "docs/valo/policies/guidance-publication-policy.md";
/** The owner's optional narrowing of what may be published. It can only take permissions away. */
const RESTRICTIONS_PATH = "docs/valo/policies/operational-publication-restrictions.json";

/**
 * The SHA-256 of the policy file as the product owner approved it. Null would mean that the owner
 * has approved no text.
 *
 * The owner approved the file by this checksum on 22 November 2026, and decision 0017 records the
 * approval. Change this only on the owner's explicit, current approval of a file's exact text, and
 * for no other reason. Any edit of the file ends the approval until the owner approves the new text.
 *
 * This is the second text the owner approved that day. The first, 5fd56570…727f, still called
 * itself proposed in its first paragraph; the owner then approved this one, which differs only in
 * what the file says about its own approval. Nothing was reviewed or published under the first.
 */
export function guidancePolicyApprovedHash(): string | null {
  return "0dcd5221c7e075c8839df3f527fe639c2e2311d9e00f642dcfb8b0fee41a0a1b";
}

/** The hosts the policy file lists, kept in the sources module so that its fetcher can read them. */
export { guidanceOfficialHosts };

/**
 * The most a guide's review request may measure before it is refused unsent, by the budget's
 * cautious count: every byte counted as a token, plus an allowance. A template's limit is 32,000. A
 * guide's request also carries its official passages and what was searched for later amendments:
 * with the passages read from the official files as fetched on 21 November 2026, the ten mapped
 * guides measure between 33,479 and 53,042.
 *
 * The policy file states this number, and the owner approved it with that file on 22 November
 * 2026.
 */
export const GUIDE_REVIEW_INPUT_CEILING = 64_000;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");

/** Sentences of the policy file the code depends on. The policy is refused if the file lacks one. */
const boundSentences = [
  "Each sentence that says what the law requires is bound to an exact passage of an official text that Valo holds a copy of.",
  "A rate, fee, penalty, threshold or deadline appears only when the quoted passage contains that number.",
  `It does not reproduce official text beyond a short quotation: no more than ${GUIDE_SHARED_WORDS_LIMIT} words in a row from a passage it cites.`,
  "An AI review is never called a professional review.",
  `A guide's review is refused before it is sent if it measures more than ${thousands(GUIDE_REVIEW_INPUT_CEILING)} by the budget's cautious count`,
  "This policy allows publication in the development environment.",
] as const;

const oneLine = (text: string) => text.replace(/\s+/g, " ");

/**
 * The policy a guide is prepared and released under. `approvedHash` and `read` are for tests of the
 * gates beyond approval; the publisher always uses the recorded approval and the real file.
 */
export async function guidancePolicy(
  options: { approvedHash?: string | null; read?: (path: string) => Promise<string> } = {},
) {
  const read =
    options.read ?? ((path: string) => readFile(resolve(publicationWorkspaceRoot(), path), "utf8"));
  const approvedHash =
    options.approvedHash === undefined ? guidancePolicyApprovedHash() : options.approvedHash;
  const text = await read(GUIDANCE_POLICY_PATH),
    fileHash = sha256(text),
    flat = oneLine(text);
  for (const sentence of boundSentences)
    if (!flat.includes(sentence)) throw Error("GUIDANCE_POLICY_EXCERPT_MISSING");
  for (const host of guidanceOfficialHosts)
    if (!text.includes(`\`${host}\``)) throw Error(`GUIDANCE_POLICY_HOST_NOT_LISTED:${host}`);
  const body = {
    // Each text of the policy file is a policy version of its own.
    version: `r1-guidance-development-1:${fileHash.slice(0, 16)}`,
    ownerApproved: approvedHash !== null && approvedHash === fileHash,
    allowedClasses: ["sourced_guidance"],
    jurisdictions: ["NG"],
    // Never "general": every subject a guide covers is treated as high impact.
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
    authorityRefs: boundSentences.map((quote): { path: string; hash: string; quote: string } => ({
      path: GUIDANCE_POLICY_PATH,
      hash: fileHash,
      quote,
    })),
    developmentOnly: true,
  };
  // The owner's restriction file stops guides as it stops templates: a suspension, or an exclusion
  // of the guides' class or of Nigeria, takes that permission out of this policy too.
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
  return { policy, authority: [{ path: GUIDANCE_POLICY_PATH, hash: fileHash, text }] };
}

/** Whether a policy's recorded excerpts are still sentences of the policy file given. */
export function guidancePolicyBindsFile(policy: PublicationBundle["policy"], text: string) {
  const flat = oneLine(text),
    fileHash = sha256(text);
  const refs = policy.authorityRefs?.filter((ref) => ref.path === GUIDANCE_POLICY_PATH) ?? [];
  return refs.length > 0 && refs.every((ref) => ref.hash === fileHash && flat.includes(ref.quote));
}
