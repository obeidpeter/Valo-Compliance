import { eq } from "drizzle-orm";
import { PreviewOwnerPriceBody, RecordOwnerPriceBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import { premiumEditions, type PremiumEdition } from "./premium-editions";
import {
  NOT_PRICEABLE,
  premiumPriceStatus,
  premiumPriceTerms,
  premiumPriceTermsId,
  recordPremiumPriceIn,
} from "./premium-prices";

/**
 * The owner's price screen (docs/architecture/commercial-settings.md, slice 1; ADM-006). Only the
 * product owner decides a premium template's price, licence and tax treatment, so only the designated
 * development owner, recently verified, reads and records them here. The owner's own sign-in is the
 * approval's author; the price is recorded by the code the `price:premium` command uses.
 */
const refusal = "Only the designated development owner can see and record premium template prices.";

/** The published premium templates from the staff library, each with its open and scheduled prices. */
export async function ownerPrices(actor: StaffActor) {
  // The owner's authority first; the templates and prices are read after, on their own connection.
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  return { items: await premiumPriceStatus() };
}

/** The exact terms and the checksum that recording them confirms. Writes nothing. */
export async function previewOwnerPrice(actor: StaffActor, raw: unknown) {
  const terms = premiumPriceTerms(PreviewOwnerPriceBody.strict().parse(raw));
  const title = await asDevelopmentOwner(
    actor,
    async (tx) => {
      const { valoManualLibrary } = await import("@workspace/db");
      const { rows } = await tx.execute<PremiumEdition>(premiumEditions(terms.edition));
      if (!rows[0] || rows[0].held) return undefined;
      const [entry] = await tx
        .select({ title: valoManualLibrary.title })
        .from(valoManualLibrary)
        .where(eq(valoManualLibrary.id, terms.edition));
      return entry?.title;
    },
    refusal,
  );
  if (title === undefined) throw new ValoProblem(409, NOT_PRICEABLE);
  return { title, terms, checksum: premiumPriceTermsId(terms) };
}

/**
 * Records the price, in the owner's transaction, when `confirm` is the checksum of exactly these terms.
 * The template's open price closes when the new one starts. Recording takes no payment.
 */
export async function recordOwnerPrice(actor: StaffActor, raw: unknown) {
  const { reference, confirm, ...given } = RecordOwnerPriceBody.strict().parse(raw);
  const terms = premiumPriceTerms(given);
  return asDevelopmentOwner(
    actor,
    (tx) =>
      recordPremiumPriceIn(tx, terms, {
        approvedBy: "the development owner, " + actor.identityId,
        reference,
        confirm,
      }),
    refusal,
  );
}
