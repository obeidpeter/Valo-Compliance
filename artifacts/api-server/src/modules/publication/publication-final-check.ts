import { evaluatePublication, type PublicationBundle } from "@workspace/valo-core";
import { practicalGuideReleasePolicy } from "./practical-guide";
import { guidancePolicy } from "./guidance-policy";
import { operationalPolicy } from "./operational-policy";
import { publicationCheckTime } from "./operational-restrictions";
import { releasePolicyKind, templateLawPolicy } from "./template-law-policy";

/** Called after retained artifact I/O and before the publication write while
 * source/row locks remain held. No HTTP/body/environment clock is accepted. */
export async function finalOperationalPublicationCheck(
  bundle: PublicationBundle,
  initialPolicyHash: string,
  reviewBy: Date,
  rightsValidUntil: string,
  requestedTime?: Date,
) {
  // The policy the release was checked against, read again: a template that states the law answers to
  // its own policy, never the templates' (docs/architecture/reviewed-route.md, part 4).
  const current =
      bundle.candidate.contentClass === "practical_guide"
        ? await practicalGuideReleasePolicy(bundle.candidate)
        : bundle.candidate.contentClass === "sourced_guidance"
          ? await guidancePolicy()
          : releasePolicyKind(bundle.candidate) === "template_law"
            ? await templateLawPolicy()
            : await operationalPolicy(),
    now = publicationCheckTime(requestedTime);
  if (!current || current.policy.hash !== initialPolicyHash) throw Error("POLICY_CHANGED_DURING_VALIDATION");
  if (
    +reviewBy <= +now ||
    Date.parse(rightsValidUntil) <= +now ||
    evaluatePublication(bundle, now).decision !== "eligible"
  )
    throw Error("STALE_RELEASE");
  return now;
}
