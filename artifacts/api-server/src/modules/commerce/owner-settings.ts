import { PreviewOwnerSettingBody, RecordOwnerSettingBody } from "@workspace/api-zod";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import {
  commercialSettingStatus,
  commercialSettingTerms,
  commercialSettingTermsId,
  commercialSettingWords,
  recordCommercialSettingIn,
} from "../commercial-settings";

/**
 * The owner's commercial settings on the owner's screen (docs/architecture/commercial-settings.md,
 * slice 3; ADM-006). Only the product owner decides a setting's value, so only the designated
 * development owner, recently verified, reads and records them here, as for prices. The owner's own
 * sign-in is the approval's author.
 */
const refusal = "Only the designated development owner can see and record commercial settings.";

/** Each setting with its default and the values in effect or scheduled to start. */
export async function ownerSettings(actor: StaffActor) {
  // The owner's authority first; the settings are read after, on their own connection.
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  return { items: await commercialSettingStatus() };
}

/** The exact terms and the checksum that recording them confirms. Writes nothing. */
export async function previewOwnerSetting(actor: StaffActor, raw: unknown) {
  const terms = commercialSettingTerms(PreviewOwnerSettingBody.strict().parse(raw));
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  return { ...commercialSettingWords(terms.key), terms, checksum: commercialSettingTermsId(terms) };
}

/**
 * Records the value, in the owner's transaction, when `confirm` is the checksum of exactly these terms.
 * The setting's open value closes when the new one starts.
 */
export async function recordOwnerSetting(actor: StaffActor, raw: unknown) {
  const { reference, confirm, ...given } = RecordOwnerSettingBody.strict().parse(raw);
  const terms = commercialSettingTerms(given);
  return asDevelopmentOwner(
    actor,
    (tx) =>
      recordCommercialSettingIn(tx, terms, {
        approvedBy: "the development owner, " + actor.identityId,
        reference,
        confirm,
      }),
    refusal,
  );
}
