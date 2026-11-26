import { PreviewOwnerBundleBody, RecordOwnerBundleBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import {
  NOT_BUNDLEABLE,
  bundleStatus,
  bundleTemplates,
  bundleTerms,
  bundleTermsId,
  recordBundleIn,
} from "./bundles";

/**
 * The owner's bundles on the owner's screen (docs/architecture/commercial-settings.md, slice 4b; ADM-006).
 * Only the product owner decides a bundle, its templates, amount, licence and tax treatment, so only the
 * designated development owner, recently verified, reads and records them here, as for prices. The owner's
 * own sign-in is the approval's author.
 */
const refusal = "Only the designated development owner can see and record bundles.";

/** Each bundle's open version and any scheduled to start, and the premium templates a bundle may hold. */
export async function ownerBundles(actor: StaffActor) {
  // The owner's authority first; the bundles and templates are read after, on their own connection.
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  return bundleStatus();
}

/** The exact terms, the templates they name and the checksum that recording them confirms. Writes nothing. */
export async function previewOwnerBundle(actor: StaffActor, raw: unknown) {
  const terms = bundleTerms(PreviewOwnerBundleBody.strict().parse(raw));
  const templates = await asDevelopmentOwner(actor, (tx) => bundleTemplates(tx, terms.items), refusal);
  if (templates.length !== terms.items.length) throw new ValoProblem(409, NOT_BUNDLEABLE);
  return { templates, terms, checksum: bundleTermsId(terms) };
}

/**
 * Records the bundle's version, in the owner's transaction, when `confirm` is the checksum of exactly these
 * terms. The bundle's open version closes when the new one starts. Recording takes no payment.
 */
export async function recordOwnerBundle(actor: StaffActor, raw: unknown) {
  const { reference, confirm, ...given } = RecordOwnerBundleBody.strict().parse(raw);
  const terms = bundleTerms(given);
  return asDevelopmentOwner(
    actor,
    (tx) =>
      recordBundleIn(tx, terms, {
        approvedBy: "the development owner, " + actor.identityId,
        reference,
        confirm,
      }),
    refusal,
  );
}
