import { readFile } from "node:fs/promises";
import { formatKobo } from "@workspace/valo-core/money";
import {
  premiumPriceStatus,
  premiumPriceTerms,
  premiumPriceTermsId,
  recordPremiumPrice,
} from "../modules/commerce";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * Operator command, development only, for a premium template's price (step 5 of the content and
 * speed plan in docs/architecture/plan.md). Only the product owner decides a price, its licence and
 * its tax treatment, so `record` needs their approval and the checksum `preview` printed for the exact
 * terms they approved. Payments still run only with a test key; recording a price takes no payment.
 *
 *   pnpm --filter @workspace/api-server price:premium status
 *     Lists the published premium templates from the staff library, with each one's edition ID and
 *     prices. Read-only.
 *   pnpm --filter @workspace/api-server price:premium preview --edition <edition ID> \
 *     --amount <naira> --licence-version <version> --licence-file <file> --tax <tax treatment> \
 *     [--from now|<ISO time with offset>] [--carries yes|no]
 *     --carries yes records the price for each later edition of the template as it is released
 *     (docs/architecture/commercial-settings.md, slice 2); it is part of the terms and their checksum.
 *     Prints the exact terms and their checksum. Writes nothing.
 *   VALO_RECORD_OWNER_PRICE_APPROVAL=owner-approved-exact-price-terms \
 *   pnpm --filter @workspace/api-server price:premium record <the same terms> \
 *     --approved-by <who approved> --reference <where the approval is written> --confirm <checksum>
 *     Records the price. The template's open price closes when the new one starts.
 */
const usage =
  "usage: premium-price.ts status | preview <terms> | record <terms> --approved-by <who> --reference <where> --confirm <checksum>; " +
  "terms: --edition <id> --amount <naira> --licence-version <version> --licence-file <file> --tax <text> [--from now|<ISO time>] [--carries yes|no]";
const [mode, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index < 0 ? undefined : rest[index + 1];
};

async function terms() {
  const file = option("--licence-file");
  if (!file) throw new Error(usage);
  return premiumPriceTerms({
    edition: option("--edition"),
    amount: option("--amount"),
    licenceVersion: option("--licence-version"),
    licenceText: await readFile(file, "utf8"),
    taxTreatment: option("--tax"),
    from: option("--from"),
    carries: option("--carries"),
  });
}

function describe(value: Awaited<ReturnType<typeof terms>>) {
  return [
    `edition:         ${value.edition}`,
    `amount:          ${formatKobo(BigInt(value.amountKobo))}`,
    `licence version: ${value.licenceVersion}`,
    `licence text:    ${value.licenceText.length} characters, starting "${value.licenceText.slice(0, 60)}"`,
    `tax treatment:   ${value.taxTreatment}`,
    `starts:          ${value.from}`,
    `later editions:  ${value.carries ? "carries to each one as it is released" : "does not carry"}`,
  ].join("\n");
}

try {
  assertDevelopmentRuntime();
  const { pool } = await import("@workspace/db");
  try {
    if (mode === "status" && !rest.length) {
      const editions = await premiumPriceStatus();
      if (!editions.length) console.log("No premium template from the staff library is published.");
      for (const e of editions) {
        console.log(`${e.title} (version ${e.version}): edition ${e.edition}`);
        if (!e.prices.length) console.log("  no price");
        for (const p of e.prices)
          console.log(
            `  ${formatKobo(BigInt(p.amountKobo))}, licence ${p.licenceVersion}, from ${p.effectiveFrom.toISOString()}` +
              (p.effectiveTo ? ` to ${p.effectiveTo.toISOString()}` : "") +
              (p.carriesToLaterEditions ? ", carries to later editions" : "") +
              (p.carriedFrom ? `, carried from price ${p.carriedFrom}` : "") +
              ` (price ${p.priceId})`,
          );
      }
    } else if (mode === "preview") {
      const value = await terms();
      console.log(describe(value));
      console.log(`checksum:        ${premiumPriceTermsId(value)}`);
      console.log(
        "Nothing was written. To record these terms, the owner's approval and this checksum are needed.",
      );
    } else if (mode === "record") {
      if (process.env.VALO_RECORD_OWNER_PRICE_APPROVAL !== "owner-approved-exact-price-terms")
        throw new Error(
          "Recording a price needs the owner's approval of these exact terms: set VALO_RECORD_OWNER_PRICE_APPROVAL=owner-approved-exact-price-terms.",
        );
      const value = await terms();
      const approvedBy = option("--approved-by"),
        reference = option("--reference"),
        confirm = option("--confirm");
      if (!approvedBy || !reference || !confirm) throw new Error(usage);
      const recorded = await recordPremiumPrice(value, { approvedBy, reference, confirm });
      console.log(
        `Recorded price ${recorded.priceId} for ${recorded.title}: ${formatKobo(BigInt(recorded.amountKobo))} from ${recorded.from.toISOString()}.`,
      );
      for (const closed of recorded.closed)
        console.log(
          `Closed price ${closed.priceId} (${formatKobo(BigInt(closed.amountKobo))}) at ${recorded.from.toISOString()}.`,
        );
    } else throw new Error(usage);
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The price command failed.");
  process.exitCode = 1;
}
