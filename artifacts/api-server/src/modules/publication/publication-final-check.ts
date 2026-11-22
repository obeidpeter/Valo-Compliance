import { evaluatePublication, type PublicationBundle } from "@workspace/valo-core";
import { practicalGuidePolicy } from "./practical-guide";
import { guidancePolicy } from "./guidance-policy";
import { operationalPolicy } from "./operational-policy";
import { publicationCheckTime } from "./operational-restrictions";

/** Called after retained artifact I/O and before the publication write while
 * source/row locks remain held. No HTTP/body/environment clock is accepted. */
export async function finalOperationalPublicationCheck(
  bundle: PublicationBundle,
  initialPolicyHash: string,
  reviewBy: Date,
  rightsValidUntil: string,
  requestedTime?: Date,
) {
  // A guide's policy is the guidance policy; everything else is released under the templates' one.
  const current =
      bundle.candidate.contentClass === "practical_guide"
        ? await practicalGuidePolicy()
        : bundle.candidate.contentClass === "sourced_guidance"
          ? await guidancePolicy()
          : await operationalPolicy(),
    now = publicationCheckTime(requestedTime);
  if (current.policy.hash !== initialPolicyHash) throw Error("POLICY_CHANGED_DURING_VALIDATION");
  if (
    +reviewBy <= +now ||
    Date.parse(rightsValidUntil) <= +now ||
    evaluatePublication(bundle, now).decision !== "eligible"
  )
    throw Error("STALE_RELEASE");
  return now;
}
