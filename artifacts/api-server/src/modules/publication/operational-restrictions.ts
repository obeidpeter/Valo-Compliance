import { z } from "zod";
import { digest, type PublicationBundle } from "@workspace/valo-core";

/** An optional owner configuration may only remove permissions already present
 * in the master policy. No override accepts new classes, jurisdictions or risks. */
export const operationalRestrictionsSchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(20).max(1000),
    excludedClasses: z.array(z.string()).max(20).default([]),
    excludedJurisdictions: z.array(z.string()).max(20).default([]),
    excludedOriginalGuidanceIds: z.array(z.string()).max(100).default([]),
    suspended: z.boolean().default(false),
  })
  .strict();
export function narrowOperationalPolicy(policy: PublicationBundle["policy"], raw: unknown) {
  const restrictions = operationalRestrictionsSchema.parse(raw);
  const guidance = (policy as PublicationBundle["policy"] & { originalGuidanceIds?: string[] })
    .originalGuidanceIds;
  if (
    restrictions.excludedClasses.some((x) => !policy.allowedClasses.includes(x)) ||
    restrictions.excludedJurisdictions.some((x) => !policy.jurisdictions.includes(x)) ||
    restrictions.excludedOriginalGuidanceIds.some((x) => !guidance?.includes(x))
  )
    throw Error("POLICY_RESTRICTION_OUTSIDE_AUTHORISED_SCOPE");
  const { hash: _oldHash, ...body } = policy;
  const narrowed = {
    ...body,
    allowedClasses: restrictions.suspended
      ? []
      : body.allowedClasses.filter((x) => !restrictions.excludedClasses.includes(x)),
    jurisdictions: body.jurisdictions.filter((x) => !restrictions.excludedJurisdictions.includes(x)),
    version: `${body.version}/restriction:${restrictions.version}`,
    authorityRefs: [
      ...(body.authorityRefs ?? []),
      {
        path: "docs/valo/policies/operational-publication-restrictions.json",
        hash: digest(restrictions),
        quote: restrictions.reason,
      },
    ],
  };
  if (guidance)
    Object.assign(narrowed, {
      originalGuidanceIds: guidance.filter((x) => !restrictions.excludedOriginalGuidanceIds.includes(x)),
    });
  return { ...narrowed, hash: digest(narrowed) } as PublicationBundle["policy"];
}

/** Validation clocks can only advance. No caller can make expired evidence fresh. */
export function publicationCheckTime(requested?: Date, realNow = new Date()) {
  if (requested && !Number.isFinite(+requested)) throw Error("INVALID_PUBLICATION_CHECK_TIME");
  return new Date(Math.max(+realNow, requested ? +requested : 0));
}
